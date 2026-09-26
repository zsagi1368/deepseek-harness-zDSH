/**
 * TC-B4-H1 face-7 discriminative locks for the lookup-probe resolver
 * (PC2 :263 homologous format: exact absolute equality + isAbsolute assertion
 * + bare-name replica negative controls) — candidate-chain shape, WS1
 * deviation-① key-shape polymorphism (SystemRoot→SYSTEMROOT→windir→WINDIR,
 * windir being the real distinct-variable fallback leg), and fail-closed
 * null when every candidate is missing (the zero-spawn face the callers
 * consume: git-runner refuses resolution, pty-registry falls through to
 * ComSpec). Defense-in-depth hardening, not a blocking fix (FB1 adjudication
 * note wording discipline).
 */
import { posix, win32 } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({ existsSync: vi.fn() }))

import { existsSync } from 'node:fs'
import { resolveLookupProbe } from '../src/system-probe.ts'

const mockExistsSync = vi.mocked(existsSync)

const ENV_KEYS = ['SystemRoot', 'SYSTEMROOT', 'windir', 'WINDIR'] as const

function withPlatform(platform: string, fn: () => void): void {
  const original = process.platform
  Object.defineProperty(process, 'platform', { value: platform })
  try {
    fn()
  } finally {
    Object.defineProperty(process, 'platform', { value: original })
  }
}

beforeEach(() => {
  mockExistsSync.mockReset()
  // Blank every root key (the resolver skips blank values); vi.unstubAllEnvs
  // restores the host's real values afterwards.
  for (const key of ENV_KEYS) vi.stubEnv(key, '')
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('resolveLookupProbe win32 candidate chain', () => {
  it('resolves %SystemRoot%\\System32\\where.exe with absolute equality, never the bare name', () => {
    withPlatform('win32', () => {
      vi.stubEnv('SystemRoot', 'C:\\Windows')
      mockExistsSync.mockReturnValue(true)
      const probe = resolveLookupProbe()
      // 绝对等值（严格强于裸名相等，PC2 :263 同款）
      expect(probe).toBe('C:\\Windows\\System32\\where.exe')
      expect(probe !== null && win32.isAbsolute(probe)).toBe(true)
      // 负对照：裸名复刻必红——探针永不等裸名，裸名非绝对。
      expect(probe).not.toBe('where.exe')
      expect(win32.isAbsolute('where.exe')).toBe(false)
    })
  })

  it('honors the all-upper MSYS/Git-Bash key shape (WS1 deviation-① posture)', () => {
    withPlatform('win32', () => {
      vi.stubEnv('SYSTEMROOT', 'C:\\WINDOWS')
      mockExistsSync.mockReturnValue(true)
      expect(resolveLookupProbe()).toBe('C:\\WINDOWS\\System32\\where.exe')
    })
  })

  it('falls back to windir as a distinct variable when the SystemRoot keys are absent', () => {
    withPlatform('win32', () => {
      vi.stubEnv('windir', 'D:\\WinDir')
      mockExistsSync.mockReturnValue(true)
      expect(resolveLookupProbe()).toBe('D:\\WinDir\\System32\\where.exe')
    })
  })

  it('skips blank and relative env values: no candidate is ever built relative', () => {
    withPlatform('win32', () => {
      vi.stubEnv('SystemRoot', '  ')
      vi.stubEnv('WINDIR', 'relative\\dir')
      mockExistsSync.mockImplementation(target => String(target) === 'C:\\Windows\\System32\\where.exe')
      expect(resolveLookupProbe()).toBe('C:\\Windows\\System32\\where.exe')
      // 判别锁：每次存在性校验的目标都是绝对路径（相对 env 值不入候选构造）。
      expect(mockExistsSync.mock.calls.length).toBeGreaterThan(0)
      for (const call of mockExistsSync.mock.calls) {
        expect(win32.isAbsolute(String(call[0]))).toBe(true)
      }
    })
  })

  it('skips a root whose System32\\where.exe is missing and reaches the fixed last resort', () => {
    withPlatform('win32', () => {
      vi.stubEnv('SystemRoot', 'C:\\Broken')
      mockExistsSync.mockImplementation(target => String(target) === 'C:\\Windows\\System32\\where.exe')
      expect(resolveLookupProbe()).toBe('C:\\Windows\\System32\\where.exe')
    })
  })

  it('fails closed to null when every candidate is missing (never a bare-name fallback)', () => {
    withPlatform('win32', () => {
      mockExistsSync.mockReturnValue(false)
      expect(resolveLookupProbe()).toBeNull()
    })
  })
})

describe('resolveLookupProbe POSIX candidate chain', () => {
  it('takes /usr/bin/which first, then /bin/which, then /usr/local/bin/which (same shape)', () => {
    withPlatform('linux', () => {
      mockExistsSync.mockReturnValue(true)
      expect(resolveLookupProbe()).toBe('/usr/bin/which')
      mockExistsSync.mockImplementation(target => String(target) !== '/usr/bin/which')
      expect(resolveLookupProbe()).toBe('/bin/which')
      mockExistsSync.mockImplementation(target => String(target) === '/usr/local/bin/which')
      expect(resolveLookupProbe()).toBe('/usr/local/bin/which')
      expect(posix.isAbsolute('/usr/local/bin/which')).toBe(true)
    })
  })

  it('fails closed to null when no which candidate exists (bare-name replica is not absolute)', () => {
    withPlatform('linux', () => {
      mockExistsSync.mockReturnValue(false)
      expect(resolveLookupProbe()).toBeNull()
      // 负对照：裸名 'which' 非绝对=复刻旧形必红。
      expect(posix.isAbsolute('which')).toBe(false)
    })
  })
})
