/**
 * Bare-name resolution seam for git-runner: the runner must never spawn a
 * PATH-dependent bare name. These tests cover the injectable resolver, the
 * per-name cache, the fail-closed path, and the platform default (both the
 * Windows `where.exe` branch and the POSIX `which` branch via a fake
 * platform), all without touching a real PATH.
 */
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi, beforeEach } from 'vitest'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  spawnSync: vi.fn(),
}))

// TC-B4-H1 face 7: the lookup probe reaches the spawn seam by absolute path
// (candidate-chain locks live in system-probe.host.spec.ts; here the seam
// contract is locked — absolute probe file, pinned cwd, fail-closed null).
vi.mock('../src/system-probe.ts', () => ({
  resolveLookupProbe: vi.fn(),
}))

import { spawn, spawnSync } from 'node:child_process'
import { resolveLookupProbe } from '../src/system-probe.ts'
import {
  resetBinaryResolver,
  resolveBinary,
  runGit,
  setBinaryResolver,
} from '../src/git-runner.ts'

const mockSpawn = vi.mocked(spawn)
const mockSpawnSync = vi.mocked(spawnSync)
const mockResolveLookupProbe = vi.mocked(resolveLookupProbe)

/** The absolute probe the resolver must hand the spawn seam (win32 default leg). */
const ABS_WHERE = 'C:\\Windows\\System32\\where.exe'

function fakeChildProcess(): EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  pid: number
} {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    pid: number
  }
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.pid = 42
  return child
}

function stubSpawnSuccess(): void {
  mockSpawn.mockImplementation(() => {
    const child = fakeChildProcess()
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from(''))
      child.stderr.emit('data', Buffer.from(''))
      child.emit('close', 0)
    })
    return child as never
  })
}

describe('binary resolution seam', () => {
  beforeEach(() => {
    resetBinaryResolver()
    mockSpawn.mockReset()
    mockSpawnSync.mockReset()
    mockResolveLookupProbe.mockReset()
    // The probe resolves to its absolute system path on every host (the
    // candidate chain itself is locked in system-probe.host.spec.ts).
    mockResolveLookupProbe.mockReturnValue(ABS_WHERE)
    // Deterministic probe cwd for the where.exe assertions below.
    process.env.SystemRoot = 'C:\\Windows'
    delete process.env.WINDIR
  })

  it('resolves through where.exe on Windows and caches the first match', () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      mockSpawnSync.mockReturnValueOnce({
        status: 0,
        stdout: 'C:\\Program Files\\Git\\cmd\\git.exe\r\nC:\\other\\git.exe\r\n',
      } as never)
      expect(resolveBinary('git')).toBe('C:\\Program Files\\Git\\cmd\\git.exe')
      expect(mockSpawnSync).toHaveBeenCalledWith(ABS_WHERE, ['git'], { encoding: 'utf8', cwd: 'C:\\Windows' })
      // 负对照（PC2 :263 同款）：裸名探针复刻必红——spawn file 恒非裸名。
      expect(mockSpawnSync).not.toHaveBeenCalledWith('where.exe', expect.anything(), expect.anything())
      // Cached: a second lookup must not re-run the PATH probe.
      expect(resolveBinary('git')).toBe('C:\\Program Files\\Git\\cmd\\git.exe')
      expect(mockSpawnSync).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })

  it('pins the where.exe probe cwd to the system root, never the runner cwd', () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: 'C:\\git\\git.exe\n' } as never)
      expect(resolveBinary('git')).toBe('C:\\git\\git.exe')
      expect(mockSpawnSync).toHaveBeenCalledWith(ABS_WHERE, ['git'], { encoding: 'utf8', cwd: 'C:\\Windows' })
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })

  it('falls back to WINDIR for the where.exe probe cwd when SystemRoot is unset', () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      delete process.env.SystemRoot
      process.env.WINDIR = 'C:\\Windows'
      mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: 'C:\\git\\git.exe\n' } as never)
      expect(resolveBinary('git')).toBe('C:\\git\\git.exe')
      expect(mockSpawnSync).toHaveBeenCalledWith(ABS_WHERE, ['git'], { encoding: 'utf8', cwd: 'C:\\Windows' })
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })

  it('leaves the where.exe probe cwd unset when neither SystemRoot nor WINDIR is present', () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      delete process.env.SystemRoot
      delete process.env.WINDIR
      mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: 'C:\\git\\git.exe\n' } as never)
      expect(resolveBinary('git')).toBe('C:\\git\\git.exe')
      // 探针自身仍恒绝对（cwd 腿与探针绝对化腿正交：cwd 缺 env 不退回裸名探针）。
      expect(mockSpawnSync).toHaveBeenCalledWith(ABS_WHERE, ['git'], { encoding: 'utf8', cwd: undefined })
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })

  it('fails closed with zero spawn when the win32 lookup probe cannot be resolved', () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      // 判别锁：探针候选全缺（resolveLookupProbe=null）→ 零子进程、解析拒绝，
      // 绝不裸名回退。
      mockResolveLookupProbe.mockReturnValue(null)
      expect(resolveBinary('git')).toBeNull()
      expect(mockSpawnSync).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })

  it('invalidates the cache when PATH changes', () => {
    const originalPath = process.env.PATH
    const resolver = vi.fn()
    resolver.mockReturnValueOnce('/path-a/git').mockReturnValueOnce('/path-b/git')
    setBinaryResolver(resolver)
    process.env.PATH = '/path-a'
    try {
      expect(resolveBinary('git')).toBe('/path-a/git')
      // Same PATH: the second lookup stays cached.
      expect(resolveBinary('git')).toBe('/path-a/git')
      expect(resolver).toHaveBeenCalledTimes(1)
      // PATH changed: the cached location may have moved, so re-resolve.
      process.env.PATH = '/path-b'
      expect(resolveBinary('git')).toBe('/path-b/git')
      expect(resolver).toHaveBeenCalledTimes(2)
    } finally {
      process.env.PATH = originalPath
    }
  })

  it('expires binary cache entries after the TTL', () => {
    vi.useFakeTimers()
    try {
      const resolver = vi.fn(() => '/resolved/git')
      setBinaryResolver(resolver)
      expect(resolveBinary('git')).toBe('/resolved/git')
      expect(resolver).toHaveBeenCalledTimes(1)
      // Still fresh within the TTL window.
      vi.advanceTimersByTime(59_000)
      expect(resolveBinary('git')).toBe('/resolved/git')
      expect(resolver).toHaveBeenCalledTimes(1)
      // Past the TTL: the cache entry is re-resolved.
      vi.advanceTimersByTime(2_000)
      expect(resolveBinary('git')).toBe('/resolved/git')
      expect(resolver).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves through which on POSIX', () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux' })
    try {
      mockResolveLookupProbe.mockReturnValue('/usr/bin/which')
      mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: '/usr/bin/git\n' } as never)
      expect(resolveBinary('git')).toBe('/usr/bin/git')
      expect(mockSpawnSync).toHaveBeenCalledWith('/usr/bin/which', ['git'], { encoding: 'utf8' })
      // 负对照（PC2 :263 同款）：裸名 which 复刻必红。
      expect(mockSpawnSync).not.toHaveBeenCalledWith('which', expect.anything(), expect.anything())
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })

  it('fails closed with zero spawn when the POSIX lookup probe cannot be resolved', () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux' })
    try {
      mockResolveLookupProbe.mockReturnValue(null)
      expect(resolveBinary('git')).toBeNull()
      expect(mockSpawnSync).not.toHaveBeenCalled()
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })

  it('fails closed when where.exe returns a non-absolute path', () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: 'git.exe\n' } as never)
      expect(resolveBinary('git')).toBeNull()
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })

  it('returns null when the platform lookup fails', () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      mockSpawnSync.mockReturnValueOnce({ status: 1, stdout: '' } as never)
      expect(resolveBinary('missing-tool')).toBeNull()
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })

  it('calls an injected resolver exactly once thanks to the cache', () => {
    const resolver = vi.fn(() => '/resolved/git')
    setBinaryResolver(resolver)
    expect(resolveBinary('git')).toBe('/resolved/git')
    expect(resolveBinary('git')).toBe('/resolved/git')
    expect(resolver).toHaveBeenCalledTimes(1)
  })

  it('clears the cache when the resolver is swapped', () => {
    setBinaryResolver(() => '/first/git')
    expect(resolveBinary('git')).toBe('/first/git')
    setBinaryResolver(() => '/second/git')
    expect(resolveBinary('git')).toBe('/second/git')
  })
})

describe('runGit with resolution', () => {
  beforeEach(() => {
    resetBinaryResolver()
    mockSpawn.mockReset()
    mockSpawnSync.mockReset()
    mockResolveLookupProbe.mockReset()
    mockResolveLookupProbe.mockReturnValue(ABS_WHERE)
  })

  it('spawns the resolved absolute path, never a bare name', async () => {
    stubSpawnSuccess()
    setBinaryResolver(() => '/resolved/git')
    const result = await runGit('/tmp/repo', ['status', '--porcelain'])
    expect(mockSpawn).toHaveBeenCalledWith('/resolved/git', ['status', '--porcelain'], expect.any(Object))
    expect(result.code).toBe(0)
  })

  it('fails closed with an error result when resolution fails', async () => {
    setBinaryResolver(() => null)
    const result = await runGit('/tmp/repo', ['status'])
    expect(result.code).toBe(-1)
    expect(result.stderr).toMatch(/git/)
    expect(mockSpawn).not.toHaveBeenCalled()
  })

  it('resolves once across repeated invocations', async () => {
    stubSpawnSuccess()
    const resolver = vi.fn(() => '/resolved/git')
    setBinaryResolver(resolver)
    await runGit('/tmp/repo', ['status'])
    await runGit('/tmp/repo', ['branch'])
    expect(resolver).toHaveBeenCalledTimes(1)
  })
})
