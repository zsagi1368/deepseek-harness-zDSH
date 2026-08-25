/** Package-owned invariant companion for `@deepseek-ai/dsh-client-workbench`. @module @deepseek-ai/dsh-client-workbench/invariant */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-workbench'
/** Cordis companion plugin name. */
export const name = 'workbench-invariant'
/** Service required before package ownership can be reserved. */
export const inject = ['invariants']
/** No runtime invariant: the IDE dock is a stateless UI host over host seams;
 * layout and fs interactions are pinned by the package's test suites. */
const install: InvariantInstaller = () => {}
/**
 * Register the package invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
