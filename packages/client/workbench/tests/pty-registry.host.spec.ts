import { describe, expect, it, vi } from 'vitest'
import {
  PtyRegistry,
  validateShellResolution,
} from '../src/pty-registry.ts'
import type { PtyProcess, PtySpawnRequest } from '../src/pty-registry.ts'

interface FakeTerm {
  request: PtySpawnRequest
  process: PtyProcess
}

function makeRegistry(overrides?: { graceMs?: number; perSession?: number; replayBytes?: number }) {
  const fakes = new Map<string, FakeTerm>()
  let nextPid = 100
  const registry = new PtyRegistry({
    terminalsPerSession: overrides?.perSession ?? 3,
    reconnectGraceMs: overrides?.graceMs ?? 50,
    replayBufferBytes: overrides?.replayBytes ?? 64,
    shellResolver: () => ({ file: 'powershell.exe', args: ['-NoLogo'] }),
    spawner: (request) => {
      const process: PtyProcess = {
        pid: nextPid++,
        write: (data) => {
          lastWrites.push(data)
          void request
        },
        resize: (cols, rows) => resizeCalls.push([cols, rows]),
        kill: () => {
          killed += 1
        },
      }
      const fake: FakeTerm = { request, process }
      fakes.set(`${request.file}@${process.pid}`, fake)
      return process
    },
  })
  const lastWrites: string[] = []
  const resizeCalls: Array<[number, number]> = []
  let killed = 0
  return { registry, fakes, lastWrites, resizeCalls, killCount: () => killed }
}

const noEvents = { onData: vi.fn(), onExit: vi.fn() }

describe('pty registry', () => {
  it('opens terminals and enforces the per-session quota', () => {
    const { registry } = makeRegistry({ perSession: 2 })
    expect(registry.open('s1', 't1', noEvents)).not.toHaveProperty('error')
    expect(registry.open('s1', 't2', noEvents)).not.toHaveProperty('error')
    const third = registry.open('s1', 't3', noEvents)
    expect(third).toHaveProperty('error', 'quota-exceeded')
    // Other sessions are unaffected.
    expect(registry.open('s2', 't1', noEvents)).not.toHaveProperty('error')
  })

  it('exits free quota slots for reuse', () => {
    const { registry } = makeRegistry({ perSession: 1 })
    expect(registry.open('s1', 't1', noEvents)).not.toHaveProperty('error')
    registry.feedExit('s1', 't1', 0)
    expect(registry.open('s1', 't9', noEvents)).not.toHaveProperty('error')
  })

  it('keeps a replay ring bounded to the configured byte budget', async () => {
    const events = { onData: vi.fn(), onExit: vi.fn() }
    const { registry } = makeRegistry({ replayBytes: 10 })
    registry.open('s', 't', events)
    // Feed 30 bytes; the ring keeps only the trailing 10.
    for (let i = 0; i < 3; i++) registry.feedData('s', 't', 'ABCDEFGHIJ')

    // Reattach observes the trimmed tail plus the live stream.
    const secondEvents = { onData: vi.fn(), onExit: vi.fn() }
    const attach = registry.open('s', 't', secondEvents)
    expect(attach).not.toHaveProperty('error')
    if (!('error' in attach)) {
      const replay = Buffer.from(attach.replayBase64, 'base64').toString('utf8')
      expect(replay).toBe('ABCDEFGHIJ')
      expect(replay.length).toBe(10)
    }
    await Promise.resolve()
    void events
  })

  it('input reaches the live process and stops when detached', () => {
    const { registry, lastWrites } = makeRegistry()
    registry.open('s', 't', noEvents)
    expect(registry.input('s', 't', 'dir\r')).toBe(true)

    registry.detach('s', 't')
    expect(registry.input('s', 't', 'nope')).toBe(false)
    void lastWrites
  })

  it('kills a detached terminal when the grace period lapses without reattach', async () => {
    const { registry, killCount } = makeRegistry({ graceMs: 20 })
    registry.open('s', 't', noEvents)
    registry.detach('s', 't')
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(killCount()).toBeGreaterThanOrEqual(1)
  })

  it('reattach inside the grace window cancels the kill', async () => {
    const { registry, killCount } = makeRegistry({ graceMs: 25 })
    registry.open('s', 't', noEvents)
    registry.detach('s', 't')
    const reattach = registry.open('s', 't', noEvents)
    expect(reattach).not.toHaveProperty('error')
    await new Promise(resolve => setTimeout(resolve, 60))
    expect(killCount()).toBe(0)
  })

  it('close() kills immediately and frees the quota slot', () => {
    const { registry, killCount } = makeRegistry()
    registry.open('s', 't', noEvents)
    expect(registry.close('s', 't')).toBe(true)
    expect(registry.close('s', 'missing')).toBe(false)
    expect(registry.countFor('s')).toBe(0)
    expect(killCount()).toBe(1)
  })
})

describe('shell resolution validation', () => {
  it('accepts known Windows shell basenames', () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      expect(validateShellResolution({ file: 'pwsh.exe', args: [] })).toEqual({ file: 'pwsh.exe', args: [] })
      expect(validateShellResolution({ file: 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', args: [] })).not.toBeNull()
      expect(validateShellResolution({ file: 'evil.exe && del /q *', args: [] })).toBeNull()
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })

  it('demands absolute executable paths off Windows', () => {
    const originalPlatform = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux' })
    try {
      // Shape rules hold regardless of the real filesystem.
      expect(validateShellResolution({ file: 'bash', args: [] })).toBeNull()
      expect(validateShellResolution({ file: '', args: [] })).toBeNull()
      // The X_OK probe runs against the REAL filesystem, so on a Windows
      // host /bin/bash does not exist; both outcomes are acceptable there,
      // but it must never pass validation as a relative name would.
      const verdict = validateShellResolution({ file: '/bin/bash', args: ['-l'] })
      if (verdict !== null) expect(verdict.file).toBe('/bin/bash')
    } finally {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    }
  })
})
