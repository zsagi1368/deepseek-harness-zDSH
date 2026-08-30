/** Package-owned invariant companion. @module @deepseek-ai/dsh-plugin-governance-host/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-plugin-governance-host'

/** Cordis companion plugin name. */
export const name = 'host-plugin-governance-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: every state change flows through one Remote method
 * that validates its arguments at the entry and returns a closed result
 * union, so there is no background event stream or cross-service relation to
 * assert against.
 */
const install: InvariantInstaller = () => {}

/** Register this package's invariant companion. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
