/**
 * Plugin integration: the `agentMemory` service provision, session-event
 * extraction intake, the registered `agent:memory` prompt section (including
 * its empty contract), service `forget`, and keyword derivation.
 *
 * Sessions and agents are minimal fakes: only `.id`, `.events`, and `.session`
 * are read, while persistence, scoring, and the system-prompt registry are the
 * real implementations mounted through `ctx.plugin`.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as AgentMemory from '../src/index.ts'
import { KEYWORD_SCAN_MESSAGES, MEMORY_SECTION_NAME, taskKeywords } from '../src/index.ts'
import { tokenize } from '../src/score.ts'

const BASE = Date.UTC(2026, 7, 21, 9, 0, 0)

function userMessage(seq: number, text: string, source: 'user' | 'plugin' = 'user'): SessionEvent {
  return {
    type: 'user/message',
    seq,
    time: BASE + seq,
    data: {
      id: `m${String(seq)}`,
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: source },
    },
  } as unknown as SessionEvent
}

function assistantMessage(turn: number, seq: number, text: string): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
    time: BASE + seq,
    data: {
      turn,
      step: 0,
      message: { id: `a${String(seq)}`, role: 'assistant', content: [{ type: 'text', text }], source: { kind: 'model' } },
    },
  } as unknown as SessionEvent
}

function turnEnd(turn: number, seq: number): SessionEvent {
  return { type: 'turn/end', seq, time: BASE + seq, data: { turn, reason: { kind: 'completed' } } } as unknown as SessionEvent
}

function fakeSession(events: SessionEvent[]): Session {
  return { id: 'sess-test', events } as unknown as Session
}

function fakeAgent(session: Session | undefined): Agent {
  return (session === undefined ? {} : { session }) as unknown as Agent
}

const contexts: Context[] = []
const roots: string[] = []

async function harness(config: Partial<AgentMemory.Config> = {}): Promise<Context> {
  roots.push(mkdtempSync(join(tmpdir(), 'zdsh-memory-plugin-')))
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(AgentMemory, { storageRoot: roots[roots.length - 1] ?? '', ...config })
  await ctx.plugin(SystemPrompt)
  return ctx
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('service surface', () => {
  it('provides the agentMemory Cordis service', async () => {
    const ctx = await harness()
    expect(ctx.get('agentMemory')).toBeInstanceOf(AgentMemory.AgentMemoryService)
  })

  it('lists stored entries through the service', async () => {
    const ctx = await harness()
    const service = ctx.get('agentMemory')
    if (!(service instanceof AgentMemory.AgentMemoryService)) throw new Error('service missing')
    await service.observe(fakeSession([userMessage(1, '我决定用 pnpm。')]), userMessage(1, '我决定用 pnpm。'))
    const listed = await service.list()
    expect(listed.length).toBe(1)
    expect(listed[0]?.kind).toBe('decision')
    expect(listed[0]?.sessionId).toBe('sess-test')
  })

  it('forgets through the service seam and reports misses', async () => {
    const ctx = await harness()
    const service = ctx.get('agentMemory')
    if (!(service instanceof AgentMemory.AgentMemoryService)) throw new Error('service missing')
    await service.observe(fakeSession([userMessage(1, '决定记录这一条')]), userMessage(1, '决定记录这一条'))
    const [recorded] = await service.list()
    expect(await service.forget('mem_missing')).toBe(false)
    expect(await service.forget(recorded?.id ?? '')).toBe(true)
    expect(await service.list()).toEqual([])
  })
})

describe('extraction intake over session events', () => {
  it('extracts a decision and its successor sentence from a human prompt', async () => {
    const ctx = await harness()
    const service = ctx.get('agentMemory') as AgentMemory.AgentMemoryService
    const event = userMessage(1, '项目太乱。我们决定迁移到 pnpm。所有安装都走 workspace。')
    await service.observe(fakeSession([event]), event)
    const listed = await service.list()
    expect(listed[0]?.text).toContain('决定迁移到 pnpm')
    expect(listed[0]?.text).toContain('所有安装都走 workspace')
  })

  it('ignores plugin-injected user-role messages', async () => {
    const ctx = await harness()
    const service = ctx.get('agentMemory') as AgentMemory.AgentMemoryService
    const event = userMessage(1, '不要把这个当成偏好', 'plugin')
    await service.observe(fakeSession([event]), event)
    expect(await service.list()).toEqual([])
  })

  it('extracts the final assistant fact when a turn completes', async () => {
    const ctx = await harness()
    const service = ctx.get('agentMemory') as AgentMemory.AgentMemoryService
    const events = [
      userMessage(1, '跑一下构建'),
      assistantMessage(0, 2, '第一步输出'),
      assistantMessage(0, 3, '构建已通过，产物在 dist。'),
      turnEnd(0, 4),
    ]
    await service.observe(fakeSession(events), events[3] ?? events[0] ?? (() => { throw new Error('unreachable') })())
    const listed = await service.list()
    expect(listed[0]?.kind).toBe('fact')
    expect(listed[0]?.text).toBe('构建已通过，产物在 dist')
  })

  it('never extracts from an assistant reply alone without a completed turn', async () => {
    const ctx = await harness()
    const service = ctx.get('agentMemory') as AgentMemory.AgentMemoryService
    const event = assistantMessage(0, 1, '构建已通过。')
    await service.observe(fakeSession([event]), event)
    expect(await service.list()).toEqual([])
  })
})

describe('prompt section injection', () => {
  it('renders nothing without an attached agent', async () => {
    const ctx = await harness()
    const service = ctx.get('agentMemory') as AgentMemory.AgentMemoryService
    expect(service.renderSection({})).toBe('')
  })

  it('injects overlapping memories into the assembled system prompt', async () => {
    const ctx = await harness()
    const service = ctx.get('agentMemory') as AgentMemory.AgentMemoryService
    const decision = userMessage(1, '我们决定迁移到 pnpm。')
    await service.observe(fakeSession([decision]), decision)

    // The new session's task keywords overlap the stored decision ("pnpm").
    const currentSession = fakeSession([userMessage(10, 'pnpm 的 workspace 怎么配置？')])
    const assembly = await ctx.systemPrompt.assemble({ agent: fakeAgent(currentSession) })
    const section = assembly.sections.find(candidate => candidate.name === MEMORY_SECTION_NAME)
    expect(section?.text).toContain('[decision]')
    expect(section?.text).toContain('决定迁移到 pnpm')
    expect(renderPrompt(assembly)).toContain('Memories from earlier sessions')
  })

  it('keeps the section empty for tasks with no keyword overlap', async () => {
    const ctx = await harness()
    const service = ctx.get('agentMemory') as AgentMemory.AgentMemoryService
    const decision = userMessage(1, '决定迁移到 pnpm。')
    await service.observe(fakeSession([decision]), decision)
    const unrelatedSession = fakeSession([userMessage(10, '帮我画一只猫')])
    const assembly = await ctx.systemPrompt.assemble({ agent: fakeAgent(unrelatedSession) })
    expect(renderPrompt(assembly)).not.toContain('Memories from earlier sessions')
    expect(renderPrompt(assembly)).not.toContain('pnpm')
  })

  it('forgets remove entries from subsequent injections', async () => {
    const ctx = await harness({ topK: 8 })
    const service = ctx.get('agentMemory') as AgentMemory.AgentMemoryService
    const decision = userMessage(1, '决定迁移到 pnpm。')
    await service.observe(fakeSession([decision]), decision)
    const [recorded] = await service.list()
    await service.forget(recorded?.id ?? '')
    const currentSession = fakeSession([userMessage(10, 'pnpm 配置问题')])
    const assembly = await ctx.systemPrompt.assemble({ agent: fakeAgent(currentSession) })
    expect(renderPrompt(assembly)).not.toContain('决定迁移到 pnpm')
  })
})

describe('task keyword derivation', () => {
  it('reads human prompts only and honors the backward scan bound', () => {
    const events = [
      userMessage(1, 'alpha 起始任务'),
      ...Array.from({ length: KEYWORD_SCAN_MESSAGES + 1 }, (_, index) => userMessage(index + 2, `后续任务 ${String(index)}`)),
    ]
    const keywords = taskKeywords(events, KEYWORD_SCAN_MESSAGES)
    expect(keywords.has(tokenize('起始任务').values().next().value ?? '')).toBe(false)
    const boundedAll = taskKeywords(events, Number.POSITIVE_INFINITY)
    expect(boundedAll.has(tokenize('alpha').values().next().value ?? '')).toBe(true)
  })

  it('returns an empty set for a session without human prompts', () => {
    expect(taskKeywords([]).size).toBe(0)
    expect(taskKeywords([userMessage(1, '注入上下文', 'plugin')]).size).toBe(0)
  })
})
