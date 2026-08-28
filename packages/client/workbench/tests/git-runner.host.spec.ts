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

import { spawn, spawnSync } from 'node:child_process'
import {
  resetBinaryResolver,
  resolveBinary,
  runGit,
  setBinaryResolver,
} from '../src/git-runner.ts'

const mockSpawn = vi.mocked(spawn)
const mockSpawnSync = vi.mocked(spawnSync)

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
      expect(mockSpawnSync).toHaveBeenCalledWith('where.exe', ['git'], { encoding: 'utf8', cwd: 'C:\\Windows' })
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
      expect(mockSpawnSync).toHaveBeenCalledWith('where.exe', ['git'], { encoding: 'utf8', cwd: 'C:\\Windows' })
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
      expect(mockSpawnSync).toHaveBeenCalledWith('where.exe', ['git'], { encoding: 'utf8', cwd: 'C:\\Windows' })
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
      expect(mockSpawnSync).toHaveBeenCalledWith('where.exe', ['git'], { encoding: 'utf8', cwd: undefined })
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
      mockSpawnSync.mockReturnValueOnce({ status: 0, stdout: '/usr/bin/git\n' } as never)
      expect(resolveBinary('git')).toBe('/usr/bin/git')
      expect(mockSpawnSync).toHaveBeenCalledWith('which', ['git'], { encoding: 'utf8' })
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
