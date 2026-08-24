/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-webstack`.
 * @module @deepseek-ai/dsh-webstack/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-webstack'

/** Cordis companion plugin name. */
export const name = 'webstack-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the aggregator is an optional provider over the host
 * `ctx.web` seam with no independent lifecycle stream; its search/fetch
 * relations are owned by the seam contracts, and engine routing/safety
 * behavior is pinned by this package's kernel and safety suites.
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
