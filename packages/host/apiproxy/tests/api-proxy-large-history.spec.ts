/**
 * #370 large-history reads: a session whose single assistant message cites
 * 100k+ streamed fragments must open without a call-stack failure and without
 * shipping every already-finalized fragment. The scale case reproduces the
 * production shape (one turn, one finalized message, provenance the size of
 * the whole stream) over the cold detached-inspection path; the semantic cases
 * pin what stays on the page (the in-flight partial), the windowCut contract
 * paging clients tile raw ranges with, and that pagination keeps replacement
 * copies grouped with their checkpoint.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { createMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'

const sid = (id: string): SessionId => id as SessionId

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`f13-${String(nextRpc++)}`), payload }
}

function chunk(seq: number): SessionEvent {
  return {
    type: 'assistant/chunk',
    seq,
    time: 1_700_000_000_000 + seq,
    data: { turn: 1, step: 1, chunk: { type: 'text-delta', index: 0, text: 'x' } },
  }
}

function message(seq: number, turn: number, sources: readonly number[]): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
    time: 1_700_000_000_500 + seq,
    surfaceOp: 'append',
    ...(sources.length === 0 ? {} : { sourceEventSeqs: [...sources] }),
    data: {
      turn,
      step: 1,
      message: createMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'done' }],
        source: { kind: 'model', provider: 'p', model: 'm' },
      }),
    },
  } as unknown as SessionEvent
}

/**
 * One finalized streaming turn: start → user → `fragmentCount` cited chunks →
 * message → end. Returns the events plus the exact chunk seqs the message cites.
 */
function finalizedTurn(startSeq: number, turn: number, fragmentCount: number): { events: SessionEvent[]; citedChunks: number[] } {
  const firstChunkSeq = startSeq + 2
  const messageSeq = firstChunkSeq + fragmentCount
  const events: SessionEvent[] = [
    { type: 'turn/start', seq: startSeq, time: startSeq, data: { turn } } as unknown as SessionEvent,
    {
      type: 'user/message', seq: startSeq + 1, time: startSeq + 1, surfaceOp: 'append',
      data: createMessage({ role: 'user', content: [{ type: 'text', text: `ask ${String(turn)}` }], source: { kind: 'user' } }),
    } as unknown as SessionEvent,
    ...Array.from({ length: fragmentCount }, (_unused, index) => chunk(firstChunkSeq + index)),
    message(messageSeq, turn, Array.from({ length: fragmentCount }, (_unused, index) => firstChunkSeq + index)),
    {
      type: 'turn/end', seq: messageSeq + 1, time: messageSeq + 1,
      data: { turn, reason: { kind: 'completed' } },
    } as unknown as SessionEvent,
  ]
  return {
    events,
    citedChunks: Array.from({ length: fragmentCount }, (_unused, index) => firstChunkSeq + index),
  }
}

async function coldHarness(events: readonly SessionEvent[]): Promise<ReturnType<typeof createApiProxy>> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  const meta = { version: 0, id: sid('session-big'), createdAt: 1, cwd: '/proj' }
  ctx.provide('sessionPersistence', {
    list: () => Promise.resolve([meta]),
    inspect: () => Promise.resolve({ meta, events: [...events] }),
  } as never)
  return createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
}

describe('#370 large history', () => {
  it('opens a 145140-fragment cold session in bounded time without shipping any finalized fragment', async () => {
    // The reported production shape: ONE turn, ONE finalized message whose
    // sourceEventSeqs cites all 145,140 streamed fragments.
    const fragments = Array.from({ length: 145_140 }, (_unused, index) => chunk(2 + index))
    const events: SessionEvent[] = [
      { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } } as unknown as SessionEvent,
      {
        type: 'user/message', seq: 1, time: 2, surfaceOp: 'append',
        data: createMessage({ role: 'user', content: [{ type: 'text', text: 'make a game' }], source: { kind: 'user' } }),
      } as unknown as SessionEvent,
      ...fragments,
      message(145_142, 1, Array.from({ length: 145_140 }, (_unused, index) => 2 + index)),
      { type: 'turn/end', seq: 145_143, time: 4, data: { turn: 1, reason: { kind: 'completed' } } } as unknown as SessionEvent,
    ]
    const api = await coldHarness(events)
    const started = performance.now()
    const response = await api.sessions.history(request({ sessionId: sid('session-big') }))
    const elapsedMs = performance.now() - started
    if (!response.result.ok) throw new Error(`history failed: ${JSON.stringify(response.result.error)}`)
    // No stack overflow, linear service time, and a page that carries the
    // conversation instead of the superseded delta stream.
    expect(elapsedMs).toBeLessThan(10_000)
    expect(response.result.value.events.map(entry => entry.event.seq)).toEqual([0, 1, 145_142, 145_143])
    expect(response.result.value.events.some(entry => entry.event.type === 'assistant/chunk')).toBe(false)
    expect(response.result.value.hasMore).toBe(false)
    expect(response.result.value.windowCut).toBe(0)
    const wireChars = JSON.stringify(response.result.value).length
    // The page carries four envelopes plus the message's own provenance array
    // (145,140 seqs ≈ 0.9 MB) — the residual after elision and ~40× under the
    // un-elided page; compacting the array itself is separate wire work.
    expect(wireChars).toBeLessThan(2 * 1024 * 1024)
    expect(wireChars).toBeGreaterThan(100 * 1024)
    // Scale telemetry for the #370 regression: raw-log size vs served page.
    const rawChars = JSON.stringify(events).length
    console.log(`[f13] fragments=145140 rawKB=${Math.round(rawChars / 1024)} pageEntries=${String(response.result.value.events.length)} wireKB=${Math.round(wireChars / 1024)} ms=${elapsedMs.toFixed(0)}`)
  }, 120_000)

  it('keeps the in-flight partial while eliding the same page finalized fragments', async () => {
    // Turn 1 finalized with 5,000 cited chunks; turn 2 streaming 300 chunks
    // with no finalized message yet. Both messages fit one page.
    const first = finalizedTurn(0, 1, 5_000)
    const secondStart = first.events.length
    const streamingChunks = Array.from({ length: 300 }, (_unused, index) => chunk(secondStart + 2 + index))
    const events: SessionEvent[] = [
      ...first.events,
      { type: 'turn/start', seq: secondStart, time: secondStart, data: { turn: 2 } } as unknown as SessionEvent,
      ...streamingChunks,
    ]
    const api = await coldHarness(events)
    const response = await api.sessions.history(request({ sessionId: sid('session-big') }))
    if (!response.result.ok) throw new Error(`history failed: ${JSON.stringify(response.result.error)}`)
    const page = response.result.value.events.map(entry => entry.event)
    const retainedChunks = page.filter(event => event.type === 'assistant/chunk')
    expect(retainedChunks.map(event => event.seq)).toEqual(streamingChunks.map(event => event.seq))
    expect(page.some(event => event.type === 'assistant/message')).toBe(true)
    const retainedSet = new Set(page.map(event => event.seq))
    expect(first.citedChunks.some(value => retainedSet.has(value))).toBe(false)
  }, 60_000)

  it('tiles raw ranges upward through windowCut across many finalized streaming turns', async () => {
    const events: SessionEvent[] = []
    for (let turn = 1; turn <= 5; turn++) {
      const { events: turnEvents } = finalizedTurn(events.length, turn, 2_000)
      events.push(...turnEvents)
    }
    const allMessages = events.filter(event => event.type === 'assistant/message').map(event => event.seq)
    const api = await coldHarness(events)
    let beforeSeq: number | undefined
    const seenMessages: number[] = []
    const seenCuts: number[] = []
    for (;;) {
      const response = await api.sessions.history(request({
        sessionId: sid('session-big'),
        ...(beforeSeq === undefined ? {} : { beforeSeq }),
        maxMessages: 1,
      }))
      if (!response.result.ok) throw new Error(`page failed at ${String(beforeSeq)}`)
      const { events: entries, hasMore, windowCut } = response.result.value
      if (windowCut === undefined) throw new Error('windowCut missing')
      // Every page carries no superseded fragments, stays below the requested
      // cursor, and reports its raw lower bound for the next hop.
      expect(entries.every(entry => entry.event.type !== 'assistant/chunk')).toBe(true)
      expect(entries.every(entry => entry.event.seq < (beforeSeq ?? Number.MAX_SAFE_INTEGER))).toBe(true)
      seenMessages.push(...entries.filter(entry => entry.event.type === 'assistant/message').map(entry => entry.event.seq))
      seenCuts.push(windowCut)
      if (!hasMore) break
      beforeSeq = windowCut
    }
    // The walk runs tail-first, so messages arrive newest-oldest.
    expect(seenMessages).toEqual([...allMessages].reverse())
    expect(seenCuts[seenCuts.length - 1]).toBe(0)
    for (let index = 1; index < seenCuts.length; index++) {
      expect(seenCuts[index]).toBeLessThan(seenCuts[index - 1] as number)
    }
  }, 120_000)

  it('keeps a compaction checkpoint and its replacement together with nothing elided between them', async () => {
    // Shadowed range holds two user messages; the replacement copy cites the
    // summary plus both. Replacement copies consume no maxMessages quota, so a
    // one-message page would end above the checkpoint; TWO counted messages
    // (fresh assistant + newest shadowed) pull the cut through the whole
    // shadowed group, landing the checkpoint on the same page. No
    // assistant/chunk exists, so elision itself must be a no-op.
    const summary = {
      type: 'compaction/summary', seq: 0, time: 1,
      data: { summary: 's', shadowedRange: { start: 1, end: 2 }, provider: 'p', model: 'm' },
    } as unknown as SessionEvent
    const shadowedFirst = {
      type: 'user/message', seq: 1, time: 2, surfaceOp: 'append',
      data: createMessage({ role: 'user', content: [{ type: 'text', text: 'old one' }], source: { kind: 'user' } }),
    } as unknown as SessionEvent
    const shadowedSecond = {
      type: 'user/message', seq: 2, time: 3, surfaceOp: 'append',
      data: createMessage({ role: 'user', content: [{ type: 'text', text: 'old two' }], source: { kind: 'user' } }),
    } as unknown as SessionEvent
    const checkpoint = {
      type: 'user/message', seq: 3, time: 4,
      surfaceOp: { op: 'replace', start: 1, end: 2 },
      sourceEventSeqs: [0, 1, 2],
      data: {
        content: [{ type: 'text', text: '<context_checkpoint>summary</context_checkpoint>' }],
        source: { kind: 'plugin', plugin: 'compact' },
      },
    } as unknown as SessionEvent
    const fresh = {
      type: 'assistant/message', seq: 4, time: 5, surfaceOp: 'append',
      data: {
        turn: 1, step: 1,
        message: createMessage({
          role: 'assistant', content: [{ type: 'text', text: 'after compaction' }],
          source: { kind: 'model', provider: 'p', model: 'm' },
        }),
      },
    } as unknown as SessionEvent
    const api = await coldHarness([summary, shadowedFirst, shadowedSecond, checkpoint, fresh])
    const tailPage = await api.sessions.history(request({ sessionId: sid('session-big'), maxMessages: 2 }))
    if (!tailPage.result.ok) throw new Error(`history failed: ${JSON.stringify(tailPage.result.error)}`)
    // The page spans the fresh assistant AND the checkpoint that replaces the
    // shadowed range it continues from — contiguous raw range [cut..4].
    expect(tailPage.result.value.events.map(entry => entry.event.seq)).toEqual([2, 3, 4])
    expect(tailPage.result.value.hasMore).toBe(true)
    expect(tailPage.result.value.windowCut).toBe(2)
    // One more hop drains history with no fragments elided anywhere.
    const olderPage = await api.sessions.history(request({ sessionId: sid('session-big'), beforeSeq: 2, maxMessages: 2 }))
    if (!olderPage.result.ok) throw new Error(`history failed: ${JSON.stringify(olderPage.result.error)}`)
    expect(olderPage.result.value.events.map(entry => entry.event.seq)).toEqual([0, 1])
    expect(olderPage.result.value.hasMore).toBe(false)
    expect(olderPage.result.value.windowCut).toBe(0)
  }, 30_000)
})
