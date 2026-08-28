/**
 * Tests for `session/resume`: replaying a stored session log onto a fresh
 * agent so the next prompt inherits the full conversation history. The
 * harness mounts the JSONL persistence backend over a temporary directory,
 * and the bridge advertises the `session.resume` capability only when a
 * persistence backend is composed.
 */

import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import { makeBridgeHarness, textResponse, type BridgeHarness } from './harness.ts'

/** Locate the single durable JSONL artifact under a persistence root. */
function findLog(root: string): string {
  for (const project of readdirSync(root)) {
    for (const session of readdirSync(join(root, project))) {
      const path = join(root, project, session, 'session.jsonl.zstd')
      if (existsSync(path)) return path
    }
  }
  throw new Error('no JSONL session log found under the persistence root')
}

describe('ACP session resume', () => {
  let tmpDir: string
  let harness: BridgeHarness | undefined

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'acp-resume-'))
  })

  afterEach(async () => {
    await harness?.dispose()
    harness = undefined
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('advertises session.resume capability only when persistence is composed', async () => {
    // Without persistence: no resume capability.
    harness = await makeBridgeHarness()
    const response = await harness.client.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { _meta: { terminal_output: true } },
    })
    expect(response.agentCapabilities?.sessionCapabilities?.resume).toBeUndefined()
    await harness.dispose()
    harness = undefined

    // With persistence: resume capability advertised.
    harness = await makeBridgeHarness({ persistenceRoot: tmpDir })
    const withPersistence = await harness.client.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { _meta: { terminal_output: true } },
    })
    expect(withPersistence.agentCapabilities?.sessionCapabilities?.resume).toEqual({})
  })

  it('preserves conversation history across a restart: create-prompt-close-resume-prompt', async () => {
    // Phase 1: create a session, send a prompt, receive an answer.
    harness = await makeBridgeHarness({
      script: [textResponse('first answer')],
      persistenceRoot: tmpDir,
    })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    const first = await harness.client.prompt({
      sessionId,
      prompt: [{ type: 'text', text: 'first prompt' }],
    })
    expect(first.stopReason).toBe('end_turn')
    // The first prompt's content reached the adapter.
    expect(harness.adapter.requests[0]?.messages.at(-1)?.content).toEqual([{ type: 'text', text: 'first prompt' }])
    await vi.waitFor(() => { expect(harness!.updates).toHaveLength(1) })

    // Phase 2: dispose the harness (simulates process restart).
    await harness.dispose()
    harness = undefined

    // Phase 3: resume the session over the same persistence root.
    harness = await makeBridgeHarness({
      script: [textResponse('second answer')],
      persistenceRoot: tmpDir,
    })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    await harness.client.resumeSession({ sessionId, cwd: process.cwd() })

    // Phase 4: prompt again. The adapter must see the full history.
    const second = await harness.client.prompt({
      sessionId,
      prompt: [{ type: 'text', text: 'second prompt' }],
    })
    expect(second.stopReason).toBe('end_turn')
    await vi.waitFor(() => { expect(harness!.updates).toHaveLength(1) })

    const messages = harness.adapter.requests[0]?.messages ?? []
    expect(messages.some(m =>
      m.content?.some(c => c.type === 'text' && (c as { text: string }).text === 'first prompt'),
    )).toBe(true)
    expect(messages.some(m =>
      m.content?.some(c => c.type === 'text' && (c as { text: string }).text === 'first answer'),
    )).toBe(true)
    // The second prompt is the last user message.
    expect(messages.at(-1)?.content).toEqual([{ type: 'text', text: 'second prompt' }])
  })

  it('rejects resume for an unknown session id', async () => {
    harness = await makeBridgeHarness({ persistenceRoot: tmpDir })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    await expect(harness.client.resumeSession({
      sessionId: 'nonexistent-session-id',
      cwd: process.cwd(),
    })).rejects.toThrow(/unknown session/)
  })

  it('rejects resume of a corrupted stored log without half-creating a session', async () => {
    // Phase 1: create a session and let it write a durable log.
    harness = await makeBridgeHarness({
      script: [textResponse('stored answer')],
      persistenceRoot: tmpDir,
    })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'stored prompt' }] })
    await harness.dispose()
    harness = undefined

    // Phase 2: corrupt the durable artifact on disk.
    writeFileSync(findLog(tmpDir), 'not a zstandard frame at all')

    // Phase 3: resume must reject with a structured invalid-parameter error
    // and leave no bridge session record behind.
    harness = await makeBridgeHarness({ persistenceRoot: tmpDir })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    await expect(harness.client.resumeSession({ sessionId, cwd: process.cwd() }))
      .rejects.toThrow(/cannot resume session/)
    await expect(harness.client.prompt({ sessionId, prompt: [{ type: 'text', text: 'probe' }] }))
      .rejects.toThrow(/unknown session/)
  })

  it('rejects resume with unsupported additionalDirectories', async () => {
    harness = await makeBridgeHarness({ persistenceRoot: tmpDir })
    await harness.client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    const { sessionId } = await harness.client.newSession({ cwd: process.cwd(), mcpServers: [] })
    await expect(harness.client.resumeSession({
      sessionId,
      cwd: process.cwd(),
      additionalDirectories: ['/tmp/other'],
    })).rejects.toThrow(/additionalDirectories/)
  })
})
