import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { mountAgentLoopTestDependencies } from '@deepseek-ai/dsh-agent-loop-testkit'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { GenerateOptions, MessageId, StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmAdapter } from '@deepseek-ai/dsh-llm'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import { textResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import SubagentRuntime, {
  SubagentCapacityError,
  SubagentDepthError,
  assertSubagentLimitValue,
} from '../src/index.ts'
import type {
  ResolvedSubagentStartRequest,
  SubagentCapabilities,
  SubagentProvider,
  SubagentResult,
  SubagentRun,
  SubagentStartRequest,
} from '../src/index.ts'
import { SubagentConcurrencyGate } from '../src/capacity.ts'

const ALL_CAPS: SubagentCapabilities = { outputSchema: true, depthLimit: true, toolFilter: true, persona: true }

/** A parent stub whose durable depth fields are readable, mirroring a real Agent. */
function depthParent(depth: number, id = 'parent'): Agent {
  return {
    id: SessionId(id),
    options: { subagentDepth: depth },
    session: { header: {} },
  } as unknown as Agent
}

/** A bare parent stub with no session or options — the opaque-caller shape. */
function bareParent(id = 'parent'): Agent {
  return { id: SessionId(id) } as unknown as Agent
}

interface DeferredRun {
  readonly run: SubagentRun
  /** Resolve the run's terminal result. */
  settle(result: SubagentResult): void
  /** Reject the run's result with an infrastructure fault. */
  fail(error: unknown): void
}

/**
 * One-shot provider whose published runs' results stay pending until the test
 * settles them, so occupancy is observable and controllable.
 */
class DeferredProvider implements SubagentProvider {
  readonly inheritsParentContext = false
  readonly capabilities = ALL_CAPS
  readonly deferred: DeferredRun[] = []
  lastRequest: ResolvedSubagentStartRequest | undefined

  constructor(
    readonly name: string,
    private failFirstStart = false,
  ) {}

  async start(request: ResolvedSubagentStartRequest): Promise<SubagentRun> {
    this.lastRequest = request
    if (this.failFirstStart) {
      this.failFirstStart = false
      throw new Error('deferred provider startup failure')
    }
    const settled = Promise.withResolvers<SubagentResult>()
    const deferred: DeferredRun = {
      run: {
        id: SessionId(`child-${this.deferred.length}`),
        localAgent: undefined,
        result: settled.promise,
        dispose: async () => {},
      },
      settle: (result) => { settled.resolve(result) },
      fail: (error) => { settled.reject(error) },
    }
    this.deferred.push(deferred)
    return deferred.run
  }

  /** The pending run the given start call produced. */
  at(index: number): DeferredRun {
    const deferred = this.deferred[index]
    if (deferred === undefined) throw new Error(`no deferred run at ${index}`)
    return deferred
  }
}

async function service(config: { maxConcurrent?: number | 'unlimited'; maxDepth?: number | 'unlimited' } = {}) {
  const ctx = new Context()
  await ctx.plugin(SubagentRuntime, config)
  return { subagents: ctx.subagents }
}

function baseRequest(parent: Agent, overrides: Partial<SubagentStartRequest> = {}): SubagentStartRequest {
  return {
    prompt: [{ type: 'text', text: 'delegate' }],
    parent,
    signal: new AbortController().signal,
    ...overrides,
  }
}

const completed: SubagentResult = { output: [{ type: 'text', text: 'ok' }], stopReason: 'completed' }
const aborted: SubagentResult = { output: [], stopReason: 'aborted' }

// --- Full-stack continuable harness (mirrors continuation.spec.ts) ---

/** One scripted response that may wait on a caller-released gate before streaming. */
interface GatedEntry {
  chunks: StreamChunk[]
  gate?: Promise<undefined>
}

/** Adapter whose entries can hold a model call open until the test releases it. */
class GatedAdapter extends LlmAdapter {
  readonly requests: GenerateOptions[] = []

  constructor(private script: GatedEntry[]) {
    super()
  }

  async * stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const entry = this.script.shift()
    if (!entry) throw new Error('GatedAdapter: script exhausted')
    // Race the caller gate against cancellation so an interrupt unblocks a
    // turn that is still waiting for its scripted response.
    if (entry.gate) {
      const cancelled = new Promise<undefined>((resolve) => {
        options.signal?.addEventListener('abort', () => { resolve(undefined) }, { once: true })
      })
      await Promise.race([entry.gate, cancelled])
    }
    if (options.signal?.aborted) throw new Error('aborted')
    for (const chunk of entry.chunks) yield chunk
  }
}

// Each persistence-backed temp root cleans up by closing its handle before
// removing the directory: Windows rmSync over a dir holding a still-open handle
// fails with EPERM.
const cleanups: Array<() => Promise<void>> = []
afterEach(async () => {
  const errors: unknown[] = []
  for (const cleanup of cleanups.splice(0)) {
    try { await cleanup() } catch (error) { errors.push(error) }
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, 'temp-root cleanup failed')
})

/** Boot loop, persistence, providers, and the runtime under the given limits. */
async function continuableStack(
  adapter: LlmAdapter,
  limits: { maxConcurrent?: number; maxDepth?: number } = {},
) {
  const ctx = new Context()
  await mountAgentLoopTestDependencies(ctx)
  const root = mkdtempSync(join(tmpdir(), 'dsh-subagent-capacity-'))
  const persistenceFiber = await ctx.plugin(JsonlSessionPersistence, { root })
  cleanups.push(async () => {
    await persistenceFiber.dispose()
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  })
  await ctx.plugin(AgentLoop, { agents: [] })
  await ctx.plugin(SubagentRuntime, limits)
  await ctx.plugin(SubagentSpawn, { providerName: 'spawn' })
  ctx.llm.registerAdapter(['mock'], adapter)
  const parent = ctx.agentLoop.create(SessionId('parent'), { provider: 'mock', model: 'mock' })
  return { ctx, parent }
}

function startSpec(parent: Agent, signal: AbortSignal = new AbortController().signal) {
  return {
    provider: 'spawn',
    label: 'child task',
    request: { prompt: [{ type: 'text' as const, text: 'child task' }], parent },
    signal,
  }
}

function userMessage(text: string) {
  return [{ type: 'text' as const, text }]
}

/** Wait until a child's Activation is gone, i.e. its handle finished disposal. */
async function waitNoActivation(ctx: Context, childId: SessionId): Promise<void> {
  await vi.waitFor(() => {
    expect(ctx.agents.get(childId)).toBeUndefined()
  }, { timeout: 5_000 })
}

/** Keep the top-level test parent out of a scripted model corpus. */
function parkParent(ctx: Context, parent: Agent): void {
  ctx.on('agent/pre-step', async ({ agent: subject }, next) => {
    if (subject !== parent) return next()
    return { kind: 'reject' as const }
  })
}

describe('SubagentConcurrencyGate', () => {
  it('admits up to the limit, refuses fast with occupancy detail, and returns slots idempotently', () => {
    const gate = new SubagentConcurrencyGate(2)
    const first = gate.acquire()
    const second = gate.acquire()
    expect(gate.size).toBe(2)
    expect(() => gate.acquire()).toThrow(SubagentCapacityError)
    expect(() => gate.acquire()).toThrow(expect.objectContaining({ active: 2, limit: 2, code: 'CAPACITY_EXCEEDED' }))
    expect(() => gate.acquire()).toThrow(/refused, not queued/)
    second.release()
    expect(gate.size).toBe(1)
    const third = gate.acquire()
    expect(gate.size).toBe(2)
    third.release()
    third.release()
    first.release()
    expect(gate.size).toBe(0)
  })

  it('admits without bound when no limit is configured', () => {
    const gate = new SubagentConcurrencyGate(undefined)
    const leases = Array.from({ length: 64 }, () => gate.acquire())
    expect(gate.size).toBe(64)
    for (const lease of leases.reverse()) lease.release()
    expect(gate.size).toBe(0)
  })
})

describe('limit value validation', () => {
  it.each([
    { label: 'a string', value: '8' as unknown },
    { label: 'NaN', value: Number.NaN },
    { label: 'a negative integer', value: -1 },
    { label: 'negative zero', value: -0 },
    { label: 'a fraction', value: 1.5 },
    { label: 'an unsafe integer', value: Number.MAX_SAFE_INTEGER + 1 },
  ])('rejects $label for both limit keys', ({ value }) => {
    expect(() => { assertSubagentLimitValue(value, 'subagent maxConcurrent') }).toThrow(TypeError)
    expect(() => { assertSubagentLimitValue(value, 'subagent maxDepth') })
      .toThrow(/must be a non-negative safe integer or 'unlimited'/)
  })

  it('accepts undefined, unlimited, zero, and plain safe integers', () => {
    expect(() => { assertSubagentLimitValue(undefined, 'k') }).not.toThrow()
    expect(() => { assertSubagentLimitValue('unlimited', 'k') }).not.toThrow()
    expect(() => { assertSubagentLimitValue(0, 'k') }).not.toThrow()
    expect(() => { assertSubagentLimitValue(Number.MAX_SAFE_INTEGER, 'k') }).not.toThrow()
  })

  it('rejects malformed plugin config at construction', async () => {
    await expect(service({ maxConcurrent: -3 })).rejects.toThrow(/subagent maxConcurrent must be/)
    await expect(service({ maxDepth: 2.5 })).rejects.toThrow(/subagent maxDepth must be/)
    const mistyped = { unknown: true } as unknown as { maxConcurrent?: number | 'unlimited' }
    await expect(service(mistyped)).rejects.toThrow(/unknown key "unknown"/)
  })
})

describe('one-shot concurrency limit', () => {
  it('refuses a start beyond the limit and recycles the slot after settlement', async () => {
    const provider = new DeferredProvider('deferred')
    const { subagents } = await service({ maxConcurrent: 2 })
    subagents.registerProvider(provider)

    const parent = bareParent()
    const first = subagents.start('deferred', baseRequest(parent))
    const second = subagents.start('deferred', baseRequest(parent))
    const refused = subagents.start('deferred', baseRequest(parent))
    await expect(refused).rejects.toBeInstanceOf(SubagentCapacityError)
    await expect(refused).rejects.toMatchObject({ active: 2, limit: 2 })
    await expect(refused).rejects.toThrow(/2 of 2 subagents are active/)

    provider.at(0).settle(completed)
    await first
    // Settlement returned the slot even though the holder never disposed.
    await expect(subagents.start('deferred', baseRequest(parent))).resolves.toBeDefined()
    await second
  })

  it('recycles the slot when the child aborts or its result rejects', async () => {
    const provider = new DeferredProvider('deferred')
    const { subagents } = await service({ maxConcurrent: 1 })
    subagents.registerProvider(provider)
    const parent = bareParent()

    const abortedRun = subagents.start('deferred', baseRequest(parent))
    provider.at(0).settle(aborted)
    await abortedRun
    // Abort path: settlement with stopReason 'aborted' returned the slot.
    const afterAbort = subagents.start('deferred', baseRequest(parent))
    await expect(afterAbort).resolves.toBeDefined()

    // Result-rejection path: an infrastructure fault on the settled result also
    // returns the slot, through the settlement handler's rejection arm.
    provider.at(1).fail(new Error('child infrastructure fault'))
    await expect(provider.at(1).run.result).rejects.toThrow('child infrastructure fault')
    await expect(subagents.start('deferred', baseRequest(parent))).resolves.toBeDefined()
  })

  it('recycles the slot when startup itself rejects', async () => {
    const provider = new DeferredProvider('flaky', true)
    const { subagents } = await service({ maxConcurrent: 1 })
    subagents.registerProvider(provider)
    const parent = bareParent()

    await expect(subagents.start('flaky', baseRequest(parent))).rejects.toThrow('deferred provider startup failure')
    await expect(subagents.start('flaky', baseRequest(parent))).resolves.toBeDefined()
  })

  it('defaults the concurrency limit to 8', async () => {
    const provider = new DeferredProvider('deferred')
    const { subagents } = await service()
    subagents.registerProvider(provider)
    const parent = bareParent()

    const runs = Array.from({ length: 8 }, () => subagents.start('deferred', baseRequest(parent)))
    await expect(subagents.start('deferred', baseRequest(parent))).rejects.toThrow(/8 of 8 subagents are active/)
    for (let index = 0; index < 8; index++) {
      provider.at(index).settle(completed)
      await runs[index]
    }
  })

  it("'unlimited' restores unbounded admission", async () => {
    const provider = new DeferredProvider('deferred')
    const { subagents } = await service({ maxConcurrent: 'unlimited' })
    subagents.registerProvider(provider)
    const parent = bareParent()

    const runs = Array.from({ length: 12 }, () => subagents.start('deferred', baseRequest(parent)))
    runs.forEach((_, index) => { provider.at(index).settle(completed) })
    await Promise.all(runs)
  })
})

describe('deployment depth ceiling', () => {
  it('fails a one-shot delegation past the ceiling before any provider work', async () => {
    const provider = new DeferredProvider('deferred')
    const { subagents } = await service()
    subagents.registerProvider(provider)

    const attempt = subagents.start('deferred', baseRequest(depthParent(3)))
    await expect(attempt).rejects.toBeInstanceOf(SubagentDepthError)
    await expect(attempt).rejects.toThrow(/depth 4 exceeds maxDepth 3/)
    expect(provider.deferred.length).toBe(0)
  })

  it('binds to the smaller of the caller cap and the ceiling without rewriting the request', async () => {
    const provider = new DeferredProvider('deferred')
    const { subagents } = await service()
    subagents.registerProvider(provider)

    // Caller cap tighter than the ceiling: it binds.
    await expect(subagents.start('deferred', baseRequest(depthParent(1), { maxDepth: 1 })))
      .rejects.toThrow(/depth 2 exceeds maxDepth 1/)

    // Caller cap looser than the ceiling: the ceiling binds.
    await expect(subagents.start('deferred', baseRequest(depthParent(3), { maxDepth: 10 })))
      .rejects.toThrow(/depth 4 exceeds maxDepth 3/)

    // Within both caps: admitted, and the provider sees the request untouched.
    await expect(subagents.start('deferred', baseRequest(depthParent(1), { maxDepth: 10 })))
      .resolves.toBeDefined()
    expect(provider.lastRequest?.maxDepth).toBe(10)
  })

  it("skips enforcement under 'unlimited'", async () => {
    const provider = new DeferredProvider('deferred')
    const { subagents } = await service({ maxDepth: 'unlimited' })
    subagents.registerProvider(provider)
    await expect(subagents.start('deferred', baseRequest(depthParent(50)))).resolves.toBeDefined()
  })

  it('skips enforcement for an unreadable parent but fails loud on a malformed depth', async () => {
    const provider = new DeferredProvider('deferred')
    const { subagents } = await service()
    subagents.registerProvider(provider)

    await expect(subagents.start('deferred', baseRequest(bareParent()))).resolves.toBeDefined()

    const malformed = {
      id: SessionId('parent'),
      options: { subagentDepth: -1 },
      session: { header: {} },
    } as unknown as Agent
    await expect(subagents.start('deferred', baseRequest(malformed)))
      .rejects.toThrow('agent subagentDepth must be a non-negative safe integer')
  })

  it('fails a continuable delegation past the ceiling before materializing', async () => {
    const { ctx, parent } = await continuableStack(new GatedAdapter([]), { maxDepth: 0 })
    parkParent(ctx, parent)
    await expect(ctx.subagents.startContinuable(startSpec(parent))).rejects.toBeInstanceOf(SubagentDepthError)
    await expect(ctx.subagents.startContinuable(startSpec(parent))).rejects.toThrow(/depth 1 exceeds maxDepth 0/)
  })
})

describe('continuable concurrency', () => {
  it('refuses a start while a resident child holds the last slot and recycles after settlement', async () => {
    const release = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([
      { chunks: textResponse('first answer'), gate: release.promise },
      { chunks: textResponse('third answer') },
    ])
    const { ctx, parent } = await continuableStack(adapter, { maxConcurrent: 1 })
    parkParent(ctx, parent)

    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await expect(ctx.subagents.startContinuable(startSpec(parent)))
      .rejects.toMatchObject({ active: 1, limit: 1, code: 'CAPACITY_EXCEEDED' })

    release.resolve(undefined)
    await waitNoActivation(ctx, started.childId)

    const restarted = await ctx.subagents.startContinuable(startSpec(parent))
    expect(restarted.childId).toBeTruthy()
    await waitNoActivation(ctx, restarted.childId)
  })

  it('recycles the slot after an interrupt aborts the child', async () => {
    const release = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([
      { chunks: textResponse('interrupted answer'), gate: release.promise },
    ])
    const { ctx, parent } = await continuableStack(adapter, { maxConcurrent: 1 })
    parkParent(ctx, parent)

    const started = await ctx.subagents.startContinuable(startSpec(parent))
    await vi.waitFor(() => { expect(adapter.requests.length).toBeGreaterThan(0) }, { timeout: 5_000 })

    ctx.subagents.interrupt(started.childId, { kind: 'user', parentSessionId: parent.id })
    await waitNoActivation(ctx, started.childId)

    await expect(ctx.subagents.startContinuable(startSpec(parent))).resolves.toBeDefined()
  })

  it('counts cold resume against the gate and passes capacity refusals through unwrapped', async () => {
    const holdA = Promise.withResolvers<undefined>()
    const holdB = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([
      { chunks: textResponse('a answer'), gate: holdA.promise },
      { chunks: textResponse('c answer') },
      { chunks: textResponse('b answer'), gate: holdB.promise },
    ])
    const { ctx, parent } = await continuableStack(adapter, { maxConcurrent: 2 })
    parkParent(ctx, parent)

    const a = await ctx.subagents.startContinuable(startSpec(parent))
    const c = await ctx.subagents.startContinuable(startSpec(parent))
    await waitNoActivation(ctx, c.childId)
    const b = await ctx.subagents.startContinuable(startSpec(parent))

    // Both slots held by A and B: resuming the cold C needs fresh admission.
    await expect(ctx.subagents.followup(parent, c.childId, userMessage('continue c'), {
      source: { kind: 'user' },
      signal: new AbortController().signal,
    })).rejects.toMatchObject({ active: 2, limit: 2, code: 'CAPACITY_EXCEEDED' })

    holdA.resolve(undefined)
    await waitNoActivation(ctx, a.childId)
    const resumed = await ctx.subagents.followup(parent, c.childId, userMessage('continue c'), {
      source: { kind: 'user' },
      signal: new AbortController().signal,
    })
    expect(String(resumed).length).toBeGreaterThan(0)

    holdB.resolve(undefined)
    await waitNoActivation(ctx, b.childId)
  })

  it('admits a followup to a resident child without taking another slot', async () => {
    const release = Promise.withResolvers<undefined>()
    const secondTurn = Promise.withResolvers<undefined>()
    const adapter = new GatedAdapter([
      { chunks: textResponse('first answer'), gate: release.promise },
      { chunks: textResponse('second answer'), gate: secondTurn.promise },
    ])
    const { ctx, parent } = await continuableStack(adapter, { maxConcurrent: 1 })
    parkParent(ctx, parent)

    const started = await ctx.subagents.startContinuable(startSpec(parent))
    const messageId: MessageId = await ctx.subagents.followup(
      parent,
      started.childId,
      userMessage('next step'),
      { source: { kind: 'user' }, signal: new AbortController().signal },
    )
    expect(messageId).toBeTruthy()
    release.resolve(undefined)
    secondTurn.resolve(undefined)
    await waitNoActivation(ctx, started.childId)
  })
})
