/**
 * `resolveShell` bare-name resolution: the where.exe probe is kept (system
 * binary), but its absolute-path result must reach the spawn seam instead of
 * the bare candidate name. These tests run the Windows branch on any host by
 * faking `process.platform` and the `spawnSync` seam, plus the POSIX branch.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn(),
}))

import { spawnSync } from 'node:child_process'
import { PtyRegistry, resolveShell, validateShellResolution } from '../src/pty-registry.ts'
import type { PtyProcess } from '../src/pty-registry.ts'

const mockSpawnSync = vi.mocked(spawnSync)

const noEvents = { onData: vi.fn(), onExit: vi.fn() }

function withPlatform(platform: string, fn: () => void): void {
  const original = process.platform
  Object.defineProperty(process, 'platform', { value: platform })
  try {
    fn()
  } finally {
    Object.defineProperty(process, 'platform', { value: original })
  }
}

describe('resolveShell absolute-path resolution', () => {
  beforeEach(() => {
    mockSpawnSync.mockReset()
    delete process.env.DSH_WORKBENCH_SHELL
    delete process.env.ComSpec
    delete process.env.SHELL
    // Deterministic probe cwd for the where.exe assertions below.
    process.env.SystemRoot = 'C:\\Windows'
    delete process.env.WINDIR
  })

  it('hands the where.exe absolute path to the spawn seam on Windows', () => {
    withPlatform('win32', () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe\r\n',
      } as never)
      expect(resolveShell()).toEqual({ file: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', args: ['-NoLogo'] })
      expect(mockSpawnSync).toHaveBeenCalledWith('where.exe', ['pwsh.exe'], { encoding: 'utf8', cwd: 'C:\\Windows' })
    })
  })

  it('pins the where.exe probe cwd to the neutral system root', () => {
    withPlatform('win32', () => {
      mockSpawnSync.mockReturnValue({ status: 0, stdout: 'C:\\pwsh\\pwsh.exe\n' } as never)
      resolveShell()
      expect(mockSpawnSync).toHaveBeenCalledWith('where.exe', ['pwsh.exe'], { encoding: 'utf8', cwd: 'C:\\Windows' })
    })
  })

  it('falls back to WINDIR for the probe cwd when SystemRoot is unset', () => {
    withPlatform('win32', () => {
      delete process.env.SystemRoot
      process.env.WINDIR = 'C:\\Windows'
      mockSpawnSync.mockReturnValue({ status: 0, stdout: 'C:\\pwsh\\pwsh.exe\n' } as never)
      resolveShell()
      expect(mockSpawnSync).toHaveBeenCalledWith('where.exe', ['pwsh.exe'], { encoding: 'utf8', cwd: 'C:\\Windows' })
    })
  })

  it('leaves the probe cwd unset when neither SystemRoot nor WINDIR is present', () => {
    withPlatform('win32', () => {
      delete process.env.SystemRoot
      delete process.env.WINDIR
      mockSpawnSync.mockReturnValue({ status: 0, stdout: 'C:\\pwsh\\pwsh.exe\n' } as never)
      resolveShell()
      expect(mockSpawnSync).toHaveBeenCalledWith('where.exe', ['pwsh.exe'], { encoding: 'utf8', cwd: undefined })
    })
  })

  it('treats an empty where.exe result as not-found and falls back to ComSpec', () => {
    withPlatform('win32', () => {
      mockSpawnSync.mockReturnValue({ status: 0, stdout: '' } as never)
      process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe'
      expect(resolveShell()).toEqual({ file: 'C:\\Windows\\System32\\cmd.exe', args: [] })
    })
  })

  it('falls back to ComSpec when where.exe finds nothing', () => {
    withPlatform('win32', () => {
      mockSpawnSync.mockReturnValue({ status: 1, stdout: '' } as never)
      process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe'
      expect(resolveShell()).toEqual({ file: 'C:\\Windows\\System32\\cmd.exe', args: [] })
    })
  })

  it('keeps the SHELL value on POSIX', () => {
    withPlatform('linux', () => {
      process.env.SHELL = '/bin/zsh'
      expect(resolveShell()).toEqual({ file: '/bin/zsh', args: ['-l'] })
    })
  })

  it('falls back to ComSpec when where.exe returns a non-absolute path', () => {
    withPlatform('win32', () => {
      mockSpawnSync.mockReturnValue({ status: 0, stdout: 'pwsh.exe\n' } as never)
      process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe'
      expect(resolveShell()).toEqual({ file: 'C:\\Windows\\System32\\cmd.exe', args: [] })
    })
  })

  it('falls back to ComSpec when where.exe throws', () => {
    withPlatform('win32', () => {
      mockSpawnSync.mockImplementation(() => { throw new Error('ENOENT') })
      process.env.ComSpec = 'C:\\Windows\\System32\\cmd.exe'
      expect(resolveShell()).toEqual({ file: 'C:\\Windows\\System32\\cmd.exe', args: [] })
    })
  })

  it('falls back to cmd.exe when ComSpec is not an absolute path', () => {
    withPlatform('win32', () => {
      mockSpawnSync.mockReturnValue({ status: 1, stdout: '' } as never)
      process.env.ComSpec = 'cmd.exe'
      expect(resolveShell()).toEqual({ file: 'cmd.exe', args: [] })
    })
  })

  it('falls back to cmd.exe when ComSpec is unset', () => {
    withPlatform('win32', () => {
      mockSpawnSync.mockReturnValue({ status: 1, stdout: '' } as never)
      expect(resolveShell()).toEqual({ file: 'cmd.exe', args: [] })
    })
  })

  it('rejects an absolute Windows path whose basename is not a known shell', () => {
    withPlatform('win32', () => {
      expect(validateShellResolution({ file: 'C:\\Tools\\evil.exe', args: [] })).toBeNull()
      expect(validateShellResolution({ file: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', args: [] })).toEqual({
        file: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
        args: [],
      })
    })
  })

  it('opens a terminal with the where.exe-resolved absolute path', () => {
    withPlatform('win32', () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        stdout: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe\r\n',
      } as never)
      let spawnedFile = ''
      const registry = new PtyRegistry({
        spawner: (request) => {
          spawnedFile = request.file
          const process: PtyProcess = { pid: 1, write: () => {}, resize: () => {}, kill: () => {} }
          return process
        },
      })
      const opened = registry.open('s', 't', noEvents)
      expect(opened).not.toHaveProperty('error')
      expect(spawnedFile).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    })
  })
})
