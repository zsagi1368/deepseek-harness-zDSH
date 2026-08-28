/**
 * path-guard realpath hardening — symlink/junction escape coverage.
 *
 * R-S43 A4/A6: checkPathAllowed must follow symlinks/junctions to their real
 * target and reject any path whose real location falls outside the allow list.
 * These tests construct temporary junctions to verify the gate.
 * @module @deepseek-ai/dsh-plugin-governance/sandbox/path-guard
 */

import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkPathAllowed } from '../src/sandbox/path-guard.ts'
import type { PluginSandboxConfig } from '../src/spec/index.ts'

const root = mkdtempSync(join(tmpdir(), 'dsh-pathguard-'))
const allowed = join(root, 'allowed')
const outside = join(root, 'outside')
mkdirSync(allowed, { recursive: true })
mkdirSync(outside, { recursive: true })
writeFileSync(join(outside, 'secret.txt'), 'top-secret')

function fsConfig(allowedPaths: string[]): PluginSandboxConfig['filesystem'] {
  return { access: 'readwrite', allowedPaths, deniedPatterns: [] }
}

describe('checkPathAllowed realpath hardening (R-S43 A4/A6)', () => {
  it('allows a real file inside the boundary', () => {
    writeFileSync(join(allowed, 'real.txt'), 'ok')
    expect(checkPathAllowed(fsConfig([allowed]), join(allowed, 'real.txt'))).toBe(true)
  })

  it('allows a not-yet-existing file whose real ancestor is inside the boundary', () => {
    const target = join(allowed, 'new-dir', 'file.txt')
    expect(checkPathAllowed(fsConfig([allowed]), target)).toBe(true)
  })

  it('rejects a path whose junction leaf escapes the allow list', () => {
    const link = join(allowed, 'link')
    try {
      symlinkSync(outside, link, 'junction')
    } catch {
      return // Platform does not support junction creation; skip.
    }
    try {
      // The junction leaf resolves to 'outside', which is not in the allow list.
      expect(checkPathAllowed(fsConfig([allowed]), link)).toBe(false)
      // A file inside the junction target is also outside the boundary.
      expect(checkPathAllowed(fsConfig([allowed]), join(link, 'secret.txt'))).toBe(false)
    } finally {
      rmSync(link, { recursive: true, force: true })
    }
  })

  it('rejects a not-yet-existing file through a junction to outside', () => {
    const link = join(allowed, 'link2')
    try {
      symlinkSync(outside, link, 'junction')
    } catch {
      return
    }
    try {
      // File does not exist yet; the deepest existing ancestor is the junction
      // itself, which resolves to 'outside' -> real location is out of bounds.
      expect(checkPathAllowed(fsConfig([allowed]), join(link, 'brand-new.txt'))).toBe(false)
    } finally {
      rmSync(link, { recursive: true, force: true })
    }
  })

  it('fails closed when a dangling junction leaf cannot be resolved', () => {
    const dang = join(allowed, 'dangling')
    try {
      symlinkSync(join(outside, 'does-not-exist'), dang, 'junction')
    } catch {
      return // Platform does not support dangling junction creation.
    }
    try {
      // The leaf exists (lstat) but realpath fails (dangling target) -> fail
      // closed because a write through it would create the target outside.
      expect(checkPathAllowed(fsConfig([allowed]), dang)).toBe(false)
    } finally {
      rmSync(dang, { recursive: true, force: true })
    }
  })

  it('fails closed when a dangling junction is mid-path', () => {
    const dang = join(allowed, 'dangling-mid')
    try {
      symlinkSync(join(outside, 'ghost-dir'), dang, 'junction')
    } catch {
      return
    }
    try {
      // The path component 'dangling-mid' is a dangling junction (exists but
      // unresolvable); the file below it does not exist on disk either.
      expect(checkPathAllowed(fsConfig([allowed]), join(dang, 'sub', 'file.txt'))).toBe(false)
    } finally {
      rmSync(dang, { recursive: true, force: true })
    }
  })
})

describe('checkPathAllowed raw-path traversal defense (POSIX fork escape)', () => {
  it('rejects a raw path containing a `..` component before resolve', () => {
    // `allowed/escape/../secret.txt` collapses lexically in resolve() to
    // `allowed/secret.txt`, but on POSIX the kernel resolves `..` against the
    // junction/symlink target of `escape` — the gate must reject the raw input.
    // The path is passed as a raw string because path.join() would already
    // normalize the `..` segment away before the gate sees it.
    expect(
      checkPathAllowed(fsConfig([allowed]), `${allowed}/escape/../secret.txt`),
    ).toBe(false)
    expect(
      checkPathAllowed(fsConfig([allowed]), `${allowed}/../outside/secret.txt`),
    ).toBe(false)
    // Windows-style separators are split and rejected too.
    expect(
      checkPathAllowed(fsConfig([allowed]), `${allowed}\\escape\\..\\secret.txt`),
    ).toBe(false)
  })

  it('rejects a raw path containing a `.` component', () => {
    expect(checkPathAllowed(fsConfig([allowed]), `${allowed}/./file.txt`)).toBe(false)
  })

  it('still allows names that merely contain dots', () => {
    writeFileSync(join(allowed, 'file.name.txt'), 'ok')
    expect(checkPathAllowed(fsConfig([allowed]), join(allowed, 'file.name.txt'))).toBe(true)
  })
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})
