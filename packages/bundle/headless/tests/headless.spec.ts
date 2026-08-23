/** Direct one-shot Agent driving, durable aggregation, flushing, and exit mapping. */

import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, CreateAgentOptions, ResumeAgentOptions } from '@deepseek-ai/dsh-agent'
import AgentDefaultModelConfig from '@deepseek-ai/dsh-agent-default-model'
import { createAssistantMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session, UserMessage } from '@deepseek-ai/dsh-session'
import { apply, Config, internals } from '../src/index.ts'

const originalInternals = { ...internals }
afterEach(() => { Object.assign(internals, originalInternals) })

interface Script {
  before?(session: Session): void
  afterPrompt(session: Session, message: UserMessage): Promise<void> | void
}

function appendTurn(
  session: Session,
  turn: number,
  message: UserMessage,
  text: string | undefined,
  completed: boolean,
): void {
  session.append('turn/start', { turn })
  session.append('step/start', { turn, step: 1 })
  session.append('user/message', message, { surfaceOp: 'append' })
  if (text !== undefined) {
    session.append('assistant/message', {
      turn,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text }],
        source: { provider: 'test-provider', model: 'test-model' },
      }),
    }, { surfaceOp: 'append' })
  }
  session.append('step/end', { turn, step: 1 })
  session.append('turn/end', {
    turn,
    reason: completed
      ? { kind: 'completed' }
      : { kind: 'aborted', reason: { kind: 'user' } },
  })
}

/** Mount the real registries around a small scripted Agent factory. */
async function bench(script: Script): Promise<{
  ctx: Context
  /** Session ids the factory was asked to create or resume, in call order. */
  ids: string[]
  run(config?: { task?: string; resume?: string }): Promise<{ code: number; out: string; err: string; order: string[] }>
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentDefaultModelConfig, { provider: 'test-provider', model: 'test-model' })
  const ids: string[] = []
  /** Assemble and register one scripted agent on `session`, owned by `ownerCtx`. */
  const attachAgent = async (
    ownerCtx: Context,
    session: Session,
    options: Pick<CreateAgentOptions, 'agentOptions' | 'setup'>,
  ): Promise<AgentHandle> => {
    let idle = Promise.resolve()
    const agent = {} as Agent
    const agentCtx = ownerCtx.extend({ agent })
    Object.assign(agent, {
      id: session.id,
      options: options.agentOptions ?? {},
      session,
      inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
      status: 'idle',
      ctx: agentCtx,
      cancel: () => {},
      runMaintenance: () => Promise.reject(new Error('not used')),
      send: () => {},
      followup: (message: UserMessage) => {
        agent.inbox.append('next-turn', message)
        idle = Promise.resolve().then(() => script.afterPrompt(session, message))
      },
      steer: () => {},
      inject: () => {},
      whenIdle: () => idle,
    } satisfies Partial<Agent>)
    await options.setup?.(agentCtx)
    script.before?.(session)
    ctx.agents.register(agent)
    return { agent, dispose: () => Promise.resolve() }
  }
  ctx.agents.setFactory({
    async createAgent(ownerCtx: Context, options: CreateAgentOptions): Promise<AgentHandle> {
      ids.push(options.sessionId)
      const session = ctx.sessions.create(options.sessionId, {
        ...options.meta === undefined ? {} : { meta: options.meta },
      })
      return attachAgent(ownerCtx, session, options)
    },
    async resume(ownerCtx: Context, options: ResumeAgentOptions): Promise<AgentHandle> {
      ids.push(options.resumeSessionId)
      const session = ctx.sessions.create(options.resumeSessionId)
      // A resumed session carries its persisted history: one completed earlier turn.
      const earlier = {
        role: 'user', content: [{ type: 'text', text: 'earlier' }], source: { kind: 'user' }, id: 'earlier',
      } as UserMessage
      appendTurn(session, 0, earlier, 'previous answer', true)
      return attachAgent(ownerCtx, session, options)
    },
  })
  return {
    ctx,
    ids,
    run: async (config: { task?: string; resume?: string } = {}) => {
      let out = ''
      let err = ''
      const order: string[] = []
      ctx.on('session/flush', () => { order.push('flush') })
      internals.stdout = { write: (chunk: string) => { out += chunk; return true } }
      internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
      const exited = new Promise<number>((resolve) => {
        ctx.provide('appExit', (code: number) => { order.push('exit'); resolve(code) })
      })
      apply(ctx, { task: 'do the thing', ...config })
      return { code: await exited, out, err, order }
    },
  }
}

describe('headless runner', () => {
  it('aggregates the final text across the complete idle-to-idle interval and flushes before exit', async () => {
    const test = await bench({
      before(session) {
        const setupMessage = {
          role: 'user', content: [{ type: 'text', text: 'setup' }], source: { kind: 'user' }, id: 'setup',
        } as UserMessage
        appendTurn(session, 0, setupMessage, 'pre-task noise', true)
      },
      async afterPrompt(session, message) {
        await Promise.resolve()
        appendTurn(session, 1, message, '', true)
        appendTurn(session, 2, message, 'final answer', true)
      },
    })
    const result = await test.run()
    expect(result.code).toBe(0)
    expect(result.err).toBe('')
    expect(result.order).toEqual(['flush', 'exit'])
    expect(result.out).toBe(`[zdsh] session-id: ${test.ids[0]}\nfinal answer\n`)
    await test.ctx.fiber.dispose()
  })

  it('waits for asynchronously appended events instead of racing Agent idleness', async () => {
    const test = await bench({
      afterPrompt: async (session, message) => {
        await new Promise(resolve => setTimeout(resolve, 5))
        appendTurn(session, 1, message, 'race-free answer', true)
      },
    })
    expect(await test.run()).toMatchObject({ code: 0, out: `[zdsh] session-id: ${test.ids[0]}\nrace-free answer\n`, err: '' })
    await test.ctx.fiber.dispose()
  })

  it('exits 1 when the final turn does not complete', async () => {
    const test = await bench({
      afterPrompt(session, message) { appendTurn(session, 1, message, undefined, false) },
    })
    expect(await test.run()).toMatchObject({ code: 1, out: `[zdsh] session-id: ${test.ids[0]}\n\n`, err: '' })
    await test.ctx.fiber.dispose()
  })

  it('prints the durable model failure when the final turn ends in error', async () => {
    const test = await bench({
      afterPrompt(session, message) {
        session.append('turn/start', { turn: 1 })
        session.append('step/start', { turn: 1, step: 1 })
        session.append('user/message', message, { surfaceOp: 'append' })
        session.append('step/end', { turn: 1, step: 1 })
        session.append('turn/end', {
          turn: 1,
          reason: { kind: 'error', error: { code: 'SERVER', message: 'provider unavailable' } },
        })
      },
    })
    expect(await test.run()).toMatchObject({
      code: 1,
      out: `[zdsh] session-id: ${test.ids[0]}\n\n`,
      err: 'dsh: SERVER: provider unavailable\n',
    })
    await test.ctx.fiber.dispose()
  })

  it('exits 1 when the owned interval contains no turn', async () => {
    const test = await bench({ afterPrompt: () => {} })
    expect(await test.run()).toMatchObject({ code: 1, out: `[zdsh] session-id: ${test.ids[0]}\n\n`, err: '' })
    await test.ctx.fiber.dispose()
  })

  it('resumes a persisted session by id and prints that id instead of minting one', async () => {
    const test = await bench({
      async afterPrompt(session, message) {
        appendTurn(session, 1, message, 'continued answer', true)
      },
    })
    test.ctx.provide('sessionPersistence', {
      list: () => Promise.resolve([{ id: SessionId('session-known') }]),
    } as never)
    const result = await test.run({ task: 'continue please', resume: 'session-known' })
    expect(result.code).toBe(0)
    expect(result.err).toBe('')
    expect(result.out).toBe('[zdsh] session-id: session-known\ncontinued answer\n')
    expect(test.ids).toEqual(['session-known'])
    // The resumed session's own history stays out of this run's summary window.
    expect(test.ctx.sessions.get(SessionId('session-known'))?.events.length).toBeGreaterThan(6)
    await test.ctx.fiber.dispose()
  })

  it('fails with a non-zero exit when the resume target does not exist', async () => {
    const test = await bench({ afterPrompt: () => {} })
    test.ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
    const result = await test.run({ task: 'x', resume: 'session-missing' })
    expect(result.code).toBe(1)
    expect(result.order).toEqual(['exit'])
    expect(result.out).toBe('')
    expect(result.err).toBe('dsh: cannot resume "session-missing": no such persisted session\n')
    expect(test.ids).toEqual([])
    await test.ctx.fiber.dispose()
  })

  it('fails with a non-zero exit when resuming without any persistence backend', async () => {
    const test = await bench({ afterPrompt: () => {} })
    const result = await test.run({ task: 'x', resume: 'session-orphan' })
    expect(result.code).toBe(1)
    expect(result.out).toBe('')
    expect(result.err).toBe('dsh: cannot resume "session-orphan": no such persisted session\n')
    await test.ctx.fiber.dispose()
  })

  it('reports a direct Agent creation failure', async () => {
    const ctx = new Context()
    let err = ''
    internals.stdout = { write: () => true }
    internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
    const exited = new Promise<number>((resolve) => {
      ctx.provide('appExit', resolve)
    })
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    ctx.provide('sessions', { flush: () => Promise.resolve(true) } as never)
    ctx.provide('agents', { create: () => Promise.reject(new Error('factory exploded')) } as never)
    apply(ctx, { task: 't' })
    expect(await exited).toBe(1)
    expect(err).toBe('dsh: factory exploded\n')
    await ctx.fiber.dispose()
  })

  it('stringifies a non-Error Agent creation failure', async () => {
    const ctx = new Context()
    let err = ''
    internals.stdout = { write: () => true }
    internals.stderr = { write: (chunk: string) => { err += chunk; return true } }
    const exited = new Promise<number>((resolve) => {
      ctx.provide('appExit', resolve)
    })
    ctx.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
    ctx.provide('sessions', { flush: () => Promise.resolve(true) } as never)
    const rejected = {
      then(_resolve: (value: never) => void, reject: (reason: unknown) => void): void {
        reject('factory exploded')
      },
    }
    ctx.provide('agents', { create: () => rejected } as never)
    apply(ctx, { task: 't' })
    expect(await exited).toBe(1)
    expect(err).toBe('dsh: factory exploded\n')
    await ctx.fiber.dispose()
  })

  it('abandons a run when the tree is disposed during Loader settlement', async () => {
    const ctx = new Context()
    let exited = false
    internals.stdout = { write: () => true }
    internals.stderr = { write: () => true }
    ctx.provide('appExit', () => { exited = true })
    const services = ctx.plugin((child: Context) => {
      child.provide('agentDefaultModel', { currentSelection: () => ({ provider: 'p', model: 'm' }) } as never)
      child.provide('sessions', {} as never)
      child.provide('agents', {} as never)
    })
    await services
    let release: () => void
    const settlement = new Promise<void>((resolve) => { release = resolve })
    ctx.provide('loader', { await: () => settlement } as never)
    apply(ctx, { task: 't' })
    await services.dispose()
    release!()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(exited).toBe(false)
    await ctx.fiber.dispose()
  })

  it('fails loud without the launcher-provided exit request', () => {
    const ctx = new Context()
    expect(() => { apply(ctx, { task: 't' }) }).toThrow('must provide ctx.appExit')
  })

  it('validates config: the task is required', () => {
    expect(() => new Config({} as never)).toThrow()
    expect(new Config({ task: 'x' })).toEqual({ task: 'x' })
    expect(new Config({ task: 'x', resume: 'session-1' })).toEqual({ task: 'x', resume: 'session-1' })
  })
})
