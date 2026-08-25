/** Package-owned invariant companion for `@deepseek-ai/dsh-autopilot`. @module @deepseek-ai/dsh-autopilot/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-autopilot'
/** Cordis companion plugin name. */
export const name = 'autopilot-invariant'
/** Service required before package ownership can be reserved. */
export const inject = ['invariants']
/** No runtime invariant: the automation loops own their session streams through the agent
 * runtime; loop-guard and escalation behavior is pinned by the package's guard suites. */
const install: InvariantInstaller = () => {}
/**
 * Register the package invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
