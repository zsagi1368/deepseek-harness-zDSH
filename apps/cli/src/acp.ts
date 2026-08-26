/**
 * `dsh acp` — the product Agent Client Protocol entrypoint: boot a profile's
 * standard composition through the shared profile boot with the
 * `@deepseek-ai/dsh-acp` bridge mounted as a launcher-injected row, then leave
 * stdin/stdout to the JSON-RPC conversation. stdout carries protocol frames
 * only (no banner, no logger line); diagnostics go to stderr, and the client
 * hanging up (stdin EOF) drains every bridge session through the tree's own
 * teardown before the process completes with exit code 0.
 *
 * The default `acp` profile auto-initializes from the shipped base bundle on
 * first use — the same out-of-the-box treatment the `web` and `headless`
 * templates get — so an external GUI needs no manual profile setup. Any other
 * `--profile <name>` must already exist, exactly as for `dsh --profile`.
 * @module @deepseek-ai/dsh/acp
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import {
  DEFAULT_PROFILE_BUNDLES,
  initProfile,
  resolveProfileDir,
  type ConfigDumpLayer,
} from '@deepseek-ai/dsh-app-boot'
import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { runDumpConfig } from './dump-config.ts'
import type { AcpInvocation } from './args.ts'
// This module itself is reached only through bin.ts's dynamic `./acp.ts`
// import, so pulling the whole boot stack statically here keeps the launcher's
// per-mode lazy loading intact.
import { runProfile } from './profile-boot.ts'

const NAME = 'dsh'

/**
 * The profile `dsh acp` serves when `--profile` is absent. Auto-initialized
 * from the base bundle only — the full agent core with no pre-created agents
 * (`session/new` creates each one), no web server, and no headless runner.
 */
export const ACP_DEFAULT_PROFILE = 'acp'

/** The bridge plugin the launcher mounts over the booted composition. */
export const ACP_PLUGIN_NAME = '@deepseek-ai/dsh-acp'

/**
 * Create the default ACP profile directory when it does not exist yet, so a
 * bare `dsh acp` boots without manual setup. Only the canonical default name
 * self-initializes; any other name follows the strict boot-path convention
 * (a missing profile fails loud instead of silently materializing).
 * @param home - the Harness home holding the profiles directory (defaults to the resolved `$DSH_HOME`).
 */
export function ensureDefaultAcpProfile(home?: string): void {
  const dir = resolveProfileDir(ACP_DEFAULT_PROFILE, home)
  if (!existsSync(join(dir, 'package.json'))) {
    initProfile(dir, DEFAULT_PROFILE_BUNDLES)
    process.stderr.write(`${NAME}: initialized profile ${ACP_DEFAULT_PROFILE} at ${dir}\n`)
  }
}

/**
 * Build the launcher-injected bridge layer: one insert patch mounting
 * {@link ACP_PLUGIN_NAME} as row `acp`. The row lands after every file layer,
 * so explicit `--provider`/`--model` flags are the last word on the bridge
 * configuration; with neither flag given the row stays config-free and the
 * composition's model defaults decide. Mounted through the Loader rather than
 * applied imperatively after boot, so teardown unmounts the bridge first —
 * while persistence and attachment services are still live — and config dumps
 * can show the exact row that would mount.
 * @param provider - optional provider route for sessions created over the bridge.
 * @param model - optional model id for sessions created over the bridge.
 * @returns the dump/boot layer carrying the bridge insert patch.
 */
export function acpBridgeLayer(provider?: string, model?: string): ConfigDumpLayer {
  /* jscpd:ignore-start -- same absent-field discipline as the bridge's own agentOptions(). */
  const row: EntryOptions = { id: 'acp', name: ACP_PLUGIN_NAME }
  if (provider !== undefined || model !== undefined) {
    row.config = {
      ...(provider !== undefined ? { provider } : {}),
      ...(model !== undefined ? { model } : {}),
    }
  }
  /* jscpd:ignore-stop */
  return { label: `${NAME} acp bridge`, patches: [{ insert: [row] }] }
}

/**
 * Run one `dsh acp` invocation end to end: a dump prints the composed tree and
 * returns; otherwise the profile boots, the bridge row mounts with the rest of
 * the tree, and this async loop stays open until the client hangs up (stdin
 * EOF) or a signal arrives — both paths drain through the bounded shutdown the
 * profile boot installed, disposing every bridge-owned agent before exit.
 * @param invocation - the parsed `dsh acp` invocation (profile, patches, bridge flags, dump request).
 * @param environment - this run's frozen environment snapshot, provided before any entry mounts.
 */
export async function runAcp(invocation: AcpInvocation, environment: LaunchEnvironmentSnapshot): Promise<void> {
  ensureDefaultAcpProfile()
  const profile = invocation.profile ?? ACP_DEFAULT_PROFILE
  const bridge = acpBridgeLayer(invocation.provider, invocation.model)
  if (invocation.dump === 'config' || invocation.dump === 'default') {
    runDumpConfig(profile, invocation.dump === 'default', invocation.patches, [bridge])
    return
  }
  /* v8 ignore start -- production stdio wiring below is exercised by the spawned
     entrypoint e2e, which drives the real bin through a full handshake. */
  const { shutdown } = await runProfile({
    environment,
    profile,
    patchFiles: invocation.patches,
    args: [],
    extraPatches: bridge.patches,
  })
  // The client owns connection lifetime: EOF (or the pipe closing) means hang
  // up. Drain gracefully with exit code 0; SIGINT/SIGTERM keep the launcher's
  // product-wide handlers (graceful drain, then forced exit). Both listeners
  // coalesce inside the shutdown controller.
  const hungUp = (): void => { void shutdown.shutdown(0) }
  process.stdin.once('end', hungUp)
  process.stdin.once('close', hungUp)
  // An EOF that landed while the tree was still booting already consumed the
  // stream events; a non-readable stdin at this point is that race, not health.
  if (!process.stdin.readable) hungUp()
  /* v8 ignore stop */
}
