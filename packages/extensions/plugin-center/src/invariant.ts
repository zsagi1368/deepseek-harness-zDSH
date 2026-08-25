/** Package-owned invariant companion for `@deepseek-ai/dsh-plugin-center`. @module @deepseek-ai/dsh-plugin-center/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-plugin-center'
/** Cordis companion plugin name. */
export const name = 'plugin-center-invariant'
/** Service required before package ownership can be reserved. */
export const inject = ['invariants']
/** No runtime invariant: the center is a catalog-facing UI + registry consumer
 * with no independent durable stream; catalog integrity is enforced by the
 * registry's validate pipeline and CI. */
const install: InvariantInstaller = () => {}
/**
 * Register the package invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
