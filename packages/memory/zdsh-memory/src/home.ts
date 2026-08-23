/**
 * Branch-local storage root resolution for the memory store.
 *
 * Mirrors the DSH_BRANCH_HOME convention of `@deepseek-ai/dsh-plugin-governance`:
 * `DSH_BRANCH_HOME` overrides the default `~/.dsh-zdsh`, keeping our branch-local
 * state parallel to — and never colliding with — the official `~/.dsh`. The logic
 * is replicated here (rather than imported) so this package's only runtime
 * dependencies stay schemastery and the atomic-write utility.
 * @module @deepseek-ai/dsh-agent-memory/home
 */

import os from 'node:os'
import { join, resolve } from 'node:path'

/** Default branch-local directory name under the user home (`~/.dsh-zdsh`). */
export const DSH_BRANCH_DIR_NAME = '.dsh-zdsh'

/** Environment variable overriding the branch home (highest-priority environment entry). */
export const DSH_BRANCH_HOME_ENV = 'DSH_BRANCH_HOME'

/** Subdirectory of the branch home holding the daily memory shards. */
export const MEMORY_DIR_NAME = 'memory'

/**
 * Resolve the branch home directory.
 *
 * Priority mirrors plugin-governance's persistence: an explicit override wins,
 * then `DSH_BRANCH_HOME`, then `~/.dsh-zdsh`.
 * @param homeOverride - explicit branch home, when a caller pins one.
 * @returns the resolved absolute branch home path.
 */
export function resolveBranchHome(homeOverride?: string): string {
  const candidate = (homeOverride ?? process.env[DSH_BRANCH_HOME_ENV])?.trim()
  if (candidate !== undefined && candidate.length > 0) return resolve(candidate)
  return join(os.homedir(), DSH_BRANCH_DIR_NAME)
}

/**
 * Resolve the memory shard root: `<branch-home>/memory`, unless an explicit
 * storage root is supplied (the Cordis config seam used by tests and deployments).
 * @param storageRoot - explicit root when configured.
 * @returns the resolved absolute memory root path.
 */
export function resolveMemoryRoot(storageRoot?: string): string {
  if (storageRoot !== undefined && storageRoot.trim().length > 0) return resolve(storageRoot)
  return join(resolveBranchHome(), MEMORY_DIR_NAME)
}
