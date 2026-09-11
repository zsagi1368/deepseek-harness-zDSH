import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import * as SlotInvariant from '../src/invariant.ts'
import { MODEL_SLOT_TITLE } from '../src/vocabulary.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry)
  await ctx.plugin(SlotInvariant)
  return ctx
}

describe('model-slots invariants', () => {
  it('accepts complete dispatch records naming built-in slots and known tiers', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('slot-invariant-valid'))
    expect(() => {
      session.append('slots/dispatch', {
        slot: MODEL_SLOT_TITLE,
        provider: 'aux-provider',
        model: 'aux-model',
        source: 'slot',
      })
      session.append('slots/dispatch', {
        slot: MODEL_SLOT_TITLE,
        provider: 'main-provider',
        model: 'main-model',
        source: 'main-route',
      })
      session.append('slots/dispatch', {
        slot: 'compaction.summarize',
        provider: 'fallback-provider',
        model: 'fallback-model',
        source: 'deployment-default',
      })
    }).not.toThrow()
  })

  it.each([
    [{ slot: '' }, /slot must be a non-empty string/],
    [{ slot: 'nope' }, /unknown slot "nope"/],
    [{ provider: '' }, /provider must be a non-empty string/],
    [{ model: 5 }, /model must be a non-empty string/],
    [{ source: 'silent' }, /is not a known resolution tier/],
  ])('rejects the malformed record %j', async (override, pattern) => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('slot-invariant-invalid'))
    expect(() => session.append('slots/dispatch', {
      slot: MODEL_SLOT_TITLE,
      provider: 'aux-provider',
      model: 'aux-model',
      source: 'slot',
      ...override,
    } as never)).toThrow(pattern)
  })

  it('validates dispatch records already present in loaded sessions at registration time', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    const session = ctx.sessions.create(SessionId('slot-invariant-loaded'))
    session.append('slots/dispatch', {
      slot: MODEL_SLOT_TITLE,
      provider: 'aux-provider',
      model: '',
      source: 'slot',
    })
    await ctx.plugin(InvariantRegistry)
    await expect(ctx.plugin(SlotInvariant)).rejects.toThrow(/model must be a non-empty string/)
  })
})
