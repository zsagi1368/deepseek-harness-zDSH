import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensureProjectDirectory } from '../src/ensure-directory.ts'
import type { ProjectDirectoryIo } from '../src/ensure-directory.ts'

describe('ensureProjectDirectory', () => {
  const tempDirs: string[] = []

  afterEach(async () => {
    for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true })
  })

  /** An io surface whose stat confirms a directory while mkdir refuses, as Windows volume roots do (#143). */
  function rootedIo(path: string) {
    const stat = vi.fn(async () => ({ isDirectory: () => true }))
    const mkdir = vi.fn(async () => {
      throw Object.assign(new Error(`EPERM: operation not permitted, mkdir '${path}'`), { code: 'EPERM' })
    })
    return { io: { stat, mkdir } satisfies ProjectDirectoryIo, stat, mkdir }
  }

  it('skips mkdir for an existing Windows volume root even though mkdir there throws EPERM', async () => {
    const { io, stat, mkdir } = rootedIo('D:\\')
    await expect(ensureProjectDirectory('D:\\', io)).resolves.toBeUndefined()
    expect(stat).toHaveBeenCalledWith('D:\\')
    expect(mkdir).not.toHaveBeenCalled()
  })

  it('skips mkdir for the POSIX single root the same way', async () => {
    const { io, mkdir } = rootedIo('/')
    await expect(ensureProjectDirectory('/', io)).resolves.toBeUndefined()
    expect(mkdir).not.toHaveBeenCalled()
  })

  it('creates a missing directory through the recursive mkdir', async () => {
    const stat = vi.fn(async () => {
      throw Object.assign(new Error("ENOENT: no such file or directory, stat 'C:\\fresh\\project'"), { code: 'ENOENT' })
    })
    const mkdir = vi.fn(async () => undefined)
    await expect(ensureProjectDirectory('C:\\fresh\\project', { stat, mkdir })).resolves.toBeUndefined()
    expect(mkdir).toHaveBeenCalledWith('C:\\fresh\\project', { recursive: true })
  })

  it('still attempts mkdir when the probe names an existing file, wrapping its EEXIST', async () => {
    const eexist = Object.assign(new Error("EEXIST: file already exists, mkdir 'C:\\plain.txt'"), { code: 'EEXIST' })
    const failure = await ensureProjectDirectory('C:\\plain.txt', {
      stat: vi.fn(async () => ({ isDirectory: () => false })),
      mkdir: vi.fn(async () => {
        throw eexist
      }),
    }).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toContain('failed to ensure project directory "C:\\plain.txt"')
    expect((failure as Error).cause).toBe(eexist)
  })

  it('lets the mkdir failure stand when the probe itself cannot resolve the path', async () => {
    const enotdir = Object.assign(new Error("ENOTDIR: not a directory, stat '/home/test/plain.txt/x'"), { code: 'ENOTDIR' })
    const enoent = Object.assign(new Error("ENOENT: no such file or directory, mkdir '/home/test/plain.txt/x/deep'"), { code: 'ENOENT' })
    const io: ProjectDirectoryIo = {
      stat: vi.fn(async () => {
        throw enotdir
      }),
      mkdir: vi.fn(async () => {
        throw enoent
      }),
    }
    await expect(ensureProjectDirectory('/home/test/plain.txt/x/deep', io)).rejects.toMatchObject({ cause: enoent })
  })

  it('provisions a real missing directory and accepts a real existing one via the default io', async () => {
    const base = await mkdtemp(join(tmpdir(), 'dsh-ensure-dir-'))
    tempDirs.push(base)
    const fresh = join(base, 'deep', 'nested')
    await expect(ensureProjectDirectory(fresh)).resolves.toBeUndefined()
    const info = await import('node:fs/promises').then(fs => fs.stat(fresh))
    expect(info.isDirectory()).toBe(true)

    await expect(ensureProjectDirectory(base)).resolves.toBeUndefined()

    const file = join(base, 'occupied.txt')
    await writeFile(file, 'not a directory')
    await expect(ensureProjectDirectory(file)).rejects.toThrow(/failed to ensure project directory/)
  })
})
