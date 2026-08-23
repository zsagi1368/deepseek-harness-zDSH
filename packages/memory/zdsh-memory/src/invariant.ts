/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-agent-memory`.
 * @module @deepseek-ai/dsh-agent-memory/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-agent-memory'

/** Cordis companion plugin name. */
export const name = 'agent-memory-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the memory store is a single-writer file-backed cache
 * with no cross-event or cross-authority relationship to police, and the
 * injected `agent:memory` section text rides the assembled system prompt that
 * the agent loop already logs verbatim in `request/header.system`, so the
 * model-visible ⟺ logged rule holds by construction of the existing
 * system-prompt channel rather than through an additional constraint here.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
