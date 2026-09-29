/**
 * Plan slot routing: plan-mode routes plan-generation requests through the
 * deployment `plan` model slot and restores the main model for execution.
 * @module @deepseek-ai/dsh-plan-mode/tests/plan-route
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { turnBoundaryProjectionDefinition } from '@deepseek-ai/dsh-agent-loop'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import ModelSlotRegistry, { MODEL_SLOT_PLAN } from '@deepseek-ai/dsh-model-slots'
import type { LlmCallConfig } from '@deepseek-ai/dsh-llm'
import PlanModeController from '../src/index.ts'

const PLAN_CONFIG = { section: 'Test plan mode instructions.' }

type RegistryConfig = ConstructorParameters<typeof ModelSlotRegistry>[1]

/**
 * Harness: the real plugin beside the services it needs, with an agent stub
 * carrying a real session and the main-model route. The root-registered
 * `agent/request` listener receives every agent-scoped dispatch.
 */
async function harness(planSlotConfig?: RegistryConfig): Promise<{ ctx: Context; agent: Agent & { session: Session } }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(SessionProjectionRegistry)
  ctx.sessionProjections.register(turnBoundaryProjectionDefinition)
  await ctx.plugin(ToolRuntime)
  if (planSlotConfig !== undefined) await ctx.plugin(ModelSlotRegistry, planSlotConfig)
  await ctx.plugin(PlanModeController, PLAN_CONFIG)
  const session = ctx.sessions.create(SessionId('plan-route'))
  const agent = {
    id: SessionId('plan-route'),
    session,
    options: { provider: 'main-provider', model: 'main-model' },
    inject() {},
  } as unknown as Agent & { session: Session }
  return { ctx, agent }
}

/** Fake recording seed: captures the config the innermost `next` would return. */
function recordingNext(requests: LlmCallConfig[]): () => Promise<LlmCallConfig> {
  return () => {
    const config: LlmCallConfig = {
      provider: 'main-provider',
      model: 'main-model',
    }
    requests.push(config)
    return Promise.resolve(config)
  }
}

function dispatchRequest(ctx: Context, agent: Agent, seed: () => Promise<LlmCallConfig>): Promise<LlmCallConfig> {
  return agentEvents(ctx, agent).waterfall(
    'agent/request',
    { turn: 1, step: 1, signal: new AbortController().signal },
    seed,
  )
}

describe('plan slot routing', () => {
  it('routes plan-generation requests through the plan slot when plan mode is active', async () => {
    const { ctx, agent } = await harness({
      slots: { [MODEL_SLOT_PLAN]: { provider: 'plan-provider', model: 'plan-model' } },
    })
    ctx.planMode.set(agent, true)
    expect(ctx.planMode.get(agent)).toEqual({ active: true })

    const requests: LlmCallConfig[] = []
    const config = await dispatchRequest(ctx, agent, recordingNext(requests))
    expect(config.provider).toBe('plan-provider')
    expect(config.model).toBe('plan-model')
    expect(requests).toHaveLength(1)
  })

  it('prefers the explicit slot statement over the deployment default', async () => {
    const { ctx, agent } = await harness({
      slots: { [MODEL_SLOT_PLAN]: { provider: 'explicit-provider', model: 'explicit-model' } },
      fallback: { provider: 'fallback-provider', model: 'fallback-model' },
    })
    ctx.planMode.set(agent, true)

    const requests: LlmCallConfig[] = []
    const config = await dispatchRequest(ctx, agent, recordingNext(requests))
    expect(config.provider).toBe('explicit-provider')
    expect(config.model).toBe('explicit-model')
  })

  it('applies the deployment default when the plan slot has no explicit entry', async () => {
    const { ctx, agent } = await harness({
      fallback: { provider: 'fallback-provider', model: 'fallback-model' },
    })
    ctx.planMode.set(agent, true)

    const requests: LlmCallConfig[] = []
    const config = await dispatchRequest(ctx, agent, recordingNext(requests))
    expect(config.provider).toBe('fallback-provider')
    expect(config.model).toBe('fallback-model')
  })

  it('leaves the main model untouched when no registry or tier is configured', async () => {
    const { ctx, agent } = await harness()
    ctx.planMode.set(agent, true)

    const requests: LlmCallConfig[] = []
    const config = await dispatchRequest(ctx, agent, recordingNext(requests))
    expect(config.provider).toBe('main-provider')
    expect(config.model).toBe('main-model')
  })

  it('leaves the main model untouched while plan mode is inactive', async () => {
    const { ctx, agent } = await harness({
      slots: { [MODEL_SLOT_PLAN]: { provider: 'plan-provider', model: 'plan-model' } },
    })
    expect(ctx.planMode.get(agent)).toEqual({ active: false })

    const requests: LlmCallConfig[] = []
    const config = await dispatchRequest(ctx, agent, recordingNext(requests))
    expect(config.provider).toBe('main-provider')
    expect(config.model).toBe('main-model')
  })

  it('restores the main model after plan mode ends, even from a plan-shaped seed', async () => {
    const { ctx, agent } = await harness({
      slots: { [MODEL_SLOT_PLAN]: { provider: 'plan-provider', model: 'plan-model' } },
    })
    ctx.planMode.set(agent, true)
    const planRequests: LlmCallConfig[] = []
    await dispatchRequest(ctx, agent, recordingNext(planRequests))
    expect(planRequests[0]?.provider).toBe('main-provider')

    // End plan mode; the execution seed replays the plan-shaped header.
    ctx.planMode.set(agent, false)
    const execRequests: LlmCallConfig[] = []
    const config = await dispatchRequest(ctx, agent, () => {
      const planShaped: LlmCallConfig = {
        provider: 'plan-provider',
        model: 'plan-model',
      }
      execRequests.push(planShaped)
      return Promise.resolve(planShaped)
    })
    expect(execRequests).toHaveLength(1)
    expect(config.provider).toBe('main-provider')
    expect(config.model).toBe('main-model')
  })

  it('does not clobber a foreign route replacement after plan mode ends', async () => {
    const { ctx, agent } = await harness({
      slots: { [MODEL_SLOT_PLAN]: { provider: 'plan-provider', model: 'plan-model' } },
    })
    ctx.planMode.set(agent, true)
    const planRequests: LlmCallConfig[] = []
    await dispatchRequest(ctx, agent, recordingNext(planRequests))

    // Plan mode ends; another listener (e.g. session model selection) replaces
    // the route with a user-chosen model BEFORE the plan listener sees it.
    ctx.planMode.set(agent, false)
    const config = await dispatchRequest(ctx, agent, () => Promise.resolve({
      provider: 'user-provider',
      model: 'user-model',
      messages: [],
    }))
    expect(config.provider).toBe('user-provider')
    expect(config.model).toBe('user-model')
  })
})
