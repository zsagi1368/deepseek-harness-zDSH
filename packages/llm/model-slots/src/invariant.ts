/** Package-owned durable slot-dispatch invariants. @module @deepseek-ai/dsh-model-slots/invariant */

import type { Context } from '@deepseek-ai/cordis'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { MODEL_SLOT_IDS, MODEL_SLOT_SOURCES } from './vocabulary.ts'
import type {} from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-model-slots'

/** Cordis companion plugin name. */
export const name = 'model-slots-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/** Validate one durable pre-dispatch record against the closed slot vocabulary. */
function validateDispatch(event: SessionEvent<'slots/dispatch'>, fail: InvariantFailure): void {
  const { slot, provider, model, source } = event.data
  if (typeof slot !== 'string' || slot.length === 0) {
    fail('slots/dispatch slot must be a non-empty string')
  }
  if (!MODEL_SLOT_IDS.has(slot)) {
    fail(`slots/dispatch names unknown slot ${JSON.stringify(slot)}`)
  }
  if (typeof provider !== 'string' || provider.length === 0) {
    fail('slots/dispatch provider must be a non-empty string')
  }
  if (typeof model !== 'string' || model.length === 0) {
    fail('slots/dispatch model must be a non-empty string')
  }
  if (typeof source !== 'string' || !MODEL_SLOT_SOURCES.has(source)) {
    fail(`slots/dispatch source ${JSON.stringify(source)} is not a known resolution tier`)
  }
}

/** Validate every dispatch record already present in one loaded session. */
function validateSession(session: Session, fail: InvariantFailure): void {
  for (const event of session.snapshotEvents()) {
    if (event.type === 'slots/dispatch') validateDispatch(event, fail)
  }
}

/** Install validation for loaded and newly appended dispatch records. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: InvariantFailure) => {
  for (const session of ctx.sessions.list()) validateSession(session, fail)
  ctx.on('session/created', (session) => { validateSession(session, fail) }, { global: true })
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [, event] = args as [Session, SessionEvent]
    if (event.type === 'slots/dispatch') validateDispatch(event, fail)
  }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the model-slots invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
