/**
 * Shared profile boot for every `dsh` surface: resolve the profile, stack its
 * patch layers (bundle layers in `dsh.profile.bundles` order, the profile's
 * own `cordis.patch.yml`, `--patch` overlays, the telemetry switch), mount the
 * tree over the profile's empty root config, keep the profile patch layer
 * live, and wire fail-loud plus bounded shutdown.
 *
 * App flags are not the launcher's business: the invocation's inner arguments
 * are provided to the tree through `ctx.cmdlineArgs`, where any injected app
 * plugin may read the same immutable snapshot.
 * @module @deepseek-ai/dsh/profile-boot
 */

import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FiberState, type Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import {
  boot,
  composeEntries,
  healProfilesModuleFallback,
  installFailLoud,
  loadOptionalPatches,
  loadOverlayPatches,
  loadProfile,
  PROFILE_PATCH_FILENAME,
  watchUserPatches,
  type Profile,
} from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'

/** Shipped agent-preset root: beside this app's own config, in both source and built layouts. */
const SHIPPED_PRESET_ROOT = fileURLToPath(new URL('../config/agent-presets/', import.meta.url))

import { DSH_LAUNCH_ENVIRONMENT_KEY, type LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { createBootProgress } from './boot-progress.ts'
import { createProcessShutdown, type ProcessShutdown } from './process-shutdown.ts'

const NAME = 'dsh'

/**
 * The home-level user patch layer (`$DSH_HOME/cordis.patch.yml`), applied
 * over every profile's own layer. Resolved per call, not at module load:
 * `$DSH_HOME` may be set by the test or launcher after import.
 * @returns the absolute patch-file path.
 */
export function homePatchPath(): string {
  return join(resolveDshHome(), PROFILE_PATCH_FILENAME)
}

/** Absolute path of this dsh installation's package.json (both anchors: src/ and lib/ sit one level under apps/cli). */
export const INSTALL_ANCHOR = fileURLToPath(new URL('../package.json', import.meta.url))

/** The launcher-injected root entry shape (the shipped presets beside this app). */
interface SystemRootEntry {
  path: string
  trust: 'system'
}

/**
 * Merge the shipped preset root into one agent-presets row's config WITHOUT
 * discarding the user's own roots (#403): the previous overlay replaced the
 * `roots` array wholesale, so every user-configured custom root silently
 * never took effect while `--dump-config` (which runs before this injection)
 * showed the configuration as if it would. The shipped root is appended
 * unless the user already lists it — resolved paths compared, case-folded on
 * Windows — so a duplicate never double-scans. A malformed (non-array)
 * `roots` falls back to the shipped-only list, keeping the boot deterministic.
 * @param userConfig - the composed user-side agent-presets row config, verbatim.
 * @returns the final config whose roots carry the user's entries plus the shipped root.
 */
export function mergedPresetRootsConfig(userConfig: Record<string, unknown>): Record<string, unknown> {
  const shipped: SystemRootEntry = { path: SHIPPED_PRESET_ROOT, trust: 'system' }
  const userRoots = userConfig.roots
  if (!Array.isArray(userRoots)) return { ...userConfig, roots: [shipped] }
  const shippedResolved = resolve(SHIPPED_PRESET_ROOT).toLowerCase()
  const listed = userRoots.some((entry) => {
    if (typeof entry !== 'object' || entry === null) return false
    const path = (entry as { path?: unknown }).path
    if (typeof path !== 'string') return false
    return process.platform === 'win32'
      ? resolve(path).toLowerCase() === shippedResolved
      : resolve(path) === shippedResolved
  })
  const userRootEntries = userRoots as unknown[]
  return listed ? userConfig : { ...userConfig, roots: [...userRootEntries, shipped] }
}

/** The session-telemetry row id the DSH_TELEMETRY_DISABLED switch targets. */
const TELEMETRY_ROW_ID = 'session-telemetry-otel'

/** The empty root entry list every profile tree patches over. */
const PROFILE_ROOT_CONFIG = `# dsh profile root — an empty entry list. The tree is composed as patches:
# each bundle in package.json's dsh.profile.bundles, then cordis.patch.yml, then any
# --patch overlays. Edit cordis.patch.yml, not this file.
[]
`

/** Root config filename inside a profile directory. */
export const PROFILE_ROOT_FILENAME = 'cordis.yml'

/**
 * Resolve the telemetry opt-out switch into its boot patch. ANY non-empty
 * value (including `'0'`/`'false'`) disables: a privacy switch prefers
 * off-by-mistake over on-by-mistake. A composition without the telemetry row
 * exports nothing, so the switch is then trivially satisfied and no patch is
 * generated — custom profiles need not mount telemetry to run with the
 * switch set.
 * @param disabledEnv - the raw `DSH_TELEMETRY_DISABLED` value (`undefined` when unset).
 * @param hasRow - whether the composition carries the telemetry row.
 * @returns the disable patch, or `undefined` when no hard-disable patch is required.
 */
export function resolveTelemetryPatch(disabledEnv: string | undefined, hasRow: boolean): PatchOptions | undefined {
  if ((disabledEnv ?? '') === '' || !hasRow) return undefined
  return { id: TELEMETRY_ROW_ID, disabled: true }
}

/**
 * Load a resolved profile for `name`: heal the shared module fallback, then
 * (re)write the empty root config. The root is always rewritten: the whole
 * composition is patch layers, and the vendored Loader's tree write-back (a
 * plugin self-disposing persists the current tree) can bake composed rows
 * into this file — which would duplicate every bundle insert on the next
 * boot. The file exists on disk only because the Loader needs a real include
 * root to anchor `baseUrl` at the profile directory (the config dump anchors
 * on the same file, so both compose over the identical base).
 * @param name - the profile name.
 * @param userLayer - `false` skips parsing `cordis.patch.yml` (the default dump).
 * @returns the loaded profile.
 */
export function prepareProfile(name: string, userLayer = true): Profile {
  healProfilesModuleFallback(INSTALL_ANCHOR)
  const profile = loadProfile(NAME, name, INSTALL_ANCHOR, undefined, { userLayer })
  writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)
  return profile
}

/** One profile's patch layers (application order) and the row index of its pre-flag composition. */
interface ComposedProfile {
  profile: Profile
  /** Bundle layers concatenated — the part below the user layers on a live reload. */
  bundlePatches: PatchOptions[]
  /** The home-level user layer (`$DSH_HOME/cordis.patch.yml`), applied after the profile's own. */
  homePatches: PatchOptions[]
  /** Layers above the user layers on a live reload: `--patch` overlays and the telemetry switch. */
  overlays: PatchOptions[]
  /**
   * id → row of the composed tree (bundles + user layers + overlays), for the
   * launcher's own row checks.
   */
  rows: ReadonlyMap<string, EntryOptions>
}

/** The full patch stack of one composed profile, in application order. */
function allPatches(composed: ComposedProfile): PatchOptions[] {
  return [
    ...composed.bundlePatches,
    ...composed.profile.patches,
    ...composed.homePatches,
    ...composed.overlays,
  ]
}

/**
 * Load `name` and compose its effective patch stack: bundle layers in
 * `dsh.profile.bundles` order (the base bundle gates the shell stacks by
 * platform on its own rows), the profile's user layer, the home-level user
 * layer (`$DSH_HOME/cordis.patch.yml` — machine-local preferences that apply
 * to every profile, so it outranks the per-profile layer), `--patch` overlays,
 * the telemetry switch, then launcher-derived extras
 * ({@link RunProfileOptions.extraPatches}).
 * @param name - the profile name.
 * @param patchFiles - `--patch` overlay paths, in argv order.
 * @param extraPatches - launcher-derived overlay rows appended after the file layers.
 * @returns the profile, its patch layers, and the composed row index.
 */
function composeProfile(
  name: string,
  patchFiles: readonly string[],
  extraPatches: readonly PatchOptions[] = [],
): ComposedProfile {
  const profile = prepareProfile(name)
  const homePatches = loadOptionalPatches(NAME, homePatchPath()) ?? []
  const overlays = patchFiles.flatMap(file => loadOverlayPatches(NAME, resolve(file)))
  const bundlePatches = profile.layers.flatMap(layer => layer.patches)
  const rows = new Map<string, EntryOptions>()
  for (const row of composeEntries([bundlePatches, profile.patches, homePatches, overlays])) {
    if (typeof row.id === 'string') rows.set(row.id, row)
  }
  const composedOverlays = [...overlays]
  // The SHIPPED root is the part of the roster only this app can resolve: it
  // sits beside this app's own config, in both the source and built layouts.
  // The writable root the roster appends is `dsh-agent-presets`' own, so a
  // launcher that never reaches this patch still finds a person's presets.
  if (rows.has('agent-presets')) {
    composedOverlays.push({
      id: 'agent-presets',
      config: mergedPresetRootsConfig(
        (rows.get('agent-presets')?.config ?? {}) as Record<string, unknown>,
      ),
    })
  }
  const telemetryPatch = resolveTelemetryPatch(process.env.DSH_TELEMETRY_DISABLED, rows.has(TELEMETRY_ROW_ID))
  if (telemetryPatch !== undefined) composedOverlays.push(telemetryPatch)
  composedOverlays.push(...mergeExtraPatches(extraPatches, rows,
    line => void process.stderr.write(`${line}\n`)))
  return { profile, bundlePatches, homePatches, overlays: composedOverlays, rows }
}

/** Options for {@link runProfile}. */
export interface RunProfileOptions {
  /** This run's frozen environment snapshot, provided before any entry mounts. */
  environment: LaunchEnvironmentSnapshot
  /** The profile name to boot. */
  profile: string
  /** `--patch` overlay paths, in argv order. */
  patchFiles: readonly string[]
  /** The invocation's inner arguments, handed to the tree through `ctx.cmdlineArgs`. */
  args: readonly string[]
  /**
   * Launcher-derived overlay rows appended after every file layer (and the
   * telemetry switch), so they have the last word on their rows. A row an
   * extra patch inserts under an id the composed tree already mounts is
   * skipped with a warning instead of double-mounting; id-targeted patches in
   * this list still apply when their row exists.
   */
  extraPatches?: readonly PatchOptions[]
}

/**
 * Merge launcher-derived overlay patches after the file layers. Only inserted
 * rows can collide: mounting an insert under an id the composition already
 * mounts would register the same plugin twice, so such a patch is skipped with
 * a warning naming the existing row as the winner. A plain id-targeted patch
 * is a normal overlay application and always passes through.
 * @param extras - the launcher-derived patches, in append order.
 * @param rows - id index of the composition built so far; read-only input, extended internally while merging this batch.
 * @param warn - sink for skipped-patch diagnostics.
 * @returns the accepted patches, verbatim, in input order.
 */
export function mergeExtraPatches(
  extras: readonly PatchOptions[],
  rows: ReadonlyMap<string, EntryOptions>,
  warn: (line: string) => void,
): PatchOptions[] {
  const accepted: PatchOptions[] = []
  const mounted = new Map(rows)
  for (const patch of extras) {
    const inserted = patch.insert ?? []
    const collision = inserted
      .map(entry => entry.id)
      .filter((id): id is string => typeof id === 'string')
      .find(id => mounted.has(id))
    if (collision !== undefined) {
      warn(`${NAME}: profile already mounts row ${JSON.stringify(collision)}; skipping the launcher-injected overlay`)
      continue
    }
    accepted.push(patch)
    if (patch.id !== undefined) {
      mounted.set(patch.id, { ...patch } as EntryOptions)
    }
    for (const entry of inserted) {
      if (typeof entry.id === 'string') mounted.set(entry.id, entry)
    }
  }
  return accepted
}

/**
 * Re-throw a watcher-setup failure unless a shutdown already owns the tree:
 * a signal aborted this invocation, or an app requested exit (`ctx.appExit`
 * from a fast one-shot) and the root's disposal rejected the in-flight setup
 * await. Either way the failure describes a tree that is exiting as asked,
 * not a broken watch.
 * @param ctx - the booted root context.
 * @param signal - this invocation's signal-shutdown fact.
 * @param error - the setup failure.
 */
function suppressShutdownError(ctx: Context, signal: AbortSignal, error: unknown): void {
  if (signal.aborted) return
  if (ctx.fiber.state !== FiberState.ACTIVE || ctx.get('loader') === undefined) return
  throw error
}

/**
 * Count the plugin entries a settled boot tree mounted: every loader entry
 * that is not explicitly disabled. A tree that exited while startup was still
 * in flight has no Loader service anymore; its count is 0, which only ever
 * shows up in a progress line for an invocation that is exiting as asked.
 * @param ctx - the settled boot context.
 * @returns the number of enabled mounted entries.
 */
function countMountedEntries(ctx: Context): number {
  const loader = ctx.get('loader')
  if (loader === undefined) return 0
  return [...loader.entries()].filter(entry => !entry.disabled).length
}

/**
 * Boot one profile invocation end to end and leave process lifetime to the
 * mounted plugins (or to a one-shot runner the composition mounts).
 * @param options - environment snapshot, profile name, overlays, and the booted app's own arguments.
 * @returns the settled root context and the shutdown controller.
 */
export async function runProfile(options: RunProfileOptions): Promise<{ ctx: Context; shutdown: ProcessShutdown }> {
  // Phase visibility (#176): configuration resolution and plugin loading are
  // the two stages whose cost a cold cache makes visible. On an interactive
  // terminal each announces itself and prints one completion line; piped and
  // machine-consumed output sees nothing, and the gate decision costs one
  // property read per boot.
  const progress = createBootProgress({ prefix: `${NAME} ${options.profile}` })
  const composed = await progress.phase(
    'resolving configuration',
    () => composeProfile(options.profile, options.patchFiles, options.extraPatches ?? []),
  )
  const app: { current?: Context } = {}
  const shutdown = createProcessShutdown(async () => { await app.current?.fiber.dispose() })
  const signalShutdown = new AbortController()
  const interrupt = (code: number): void => {
    signalShutdown.abort()
    shutdown.interrupt(code)
  }
  // Signals own teardown throughout the startup window, not only after boot()
  // settles: an inserted provider can publish before sibling rows finish mounting.
  // SIGTERM is a supervisor's ordinary stop request and exits 0 on every
  // surface — the launcher does not know whether the app considered its work
  // complete; SIGINT is a user interrupt and reports 130.
  process.on('SIGTERM', () => { interrupt(0) })
  process.on('SIGINT', () => { interrupt(130) })
  installFailLoud(NAME, process, async () => {
    await app.current?.fiber.dispose()
  })

  const rootConfig = join(composed.profile.dir, PROFILE_ROOT_FILENAME)
  // Recomposition for the live user layers: bundle layers below, overlays
  // above, so a user edit can never displace them. Parsed app arguments are
  // not in here at all — they live in app-provided services that survive a
  // recomposition. BOTH
  // user files are re-read per generation (the HMR watcher hands us only the
  // changed file's patches, which one of the reads duplicates — fresh reads
  // keep the two watchers from stitching in each other's stale copy).
  // Fresh clones per generation: the include pushes `insert` rows into the
  // mounted tree BY REFERENCE and later id-targeted patches mutate those
  // objects in place. Reusing one parsed patch object across applications
  // would bake a user override into the bundle's in-memory insert row, so
  // removing the override could never revert the row to the bundle default.
  const composeLive = (): PatchOptions[] => structuredClone([
    ...composed.bundlePatches,
    ...loadOptionalPatches(NAME, composed.profile.patchPath) ?? [],
    ...loadOptionalPatches(NAME, homePatchPath()) ?? [],
    ...composed.overlays,
  ])
  // Cloned for the same insert-aliasing reason as composeLive: the boot
  // application must not mutate the objects later reloads recompose from.
  const ctx = await progress.phase('loading plugins', () => boot(NAME, rootConfig, structuredClone(allPatches(composed)), (hostCtx) => {
    app.current = hostCtx
    // Before any config-tree entry mounts, so plugins resolve all launch-time
    // environment values from the same immutable provenance snapshot.
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, options.environment)
    // The command line and bounded exit request are launcher facts available
    // to every app plugin that injects the argument snapshot.
    provideCmdline(hostCtx, {
      args: options.args,
      exit: code => void shutdown.shutdown(code),
    })
  }), booted => `${countMountedEntries(booted)} plugin entries mounted`)
  app.current = ctx
  // A surface can dispose the whole tree while boot or this post-boot watcher
  // setup is still in flight — a signal, or a fast one-shot's appExit. Loader
  // presence and fiber state own liveness; the initial check skips a tree
  // that already exited, and the catch below re-checks for an exit that
  // landed mid-setup. Watching is unconditional: a one-shot surface exits
  // through its bounded shutdown, which disposes the watchers before the
  // loop drains.
  if (!signalShutdown.signal.aborted
    && ctx.fiber.state === FiberState.ACTIVE
    && ctx.get('loader') !== undefined) {
    try {
      // Config-only HMR for the live profile patch layer: the web bundle
      // disables the shared module-reload `hmr` row (its reload lifecycle is
      // untested), so when the composition leaves no HMR service, mount a
      // watch-only instance with no module roots — cordis.patch.yml edits stay
      // live on every long-lived surface. A silent skip would break the
      // documented hot-reload contract. HMR injects the timer service, which a
      // bare custom profile may not mount either.
      if (ctx.get('hmr') === undefined) {
        if (ctx.get('timer') === undefined) {
          await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-timer' })
        }
        await ctx.loader.create({ name: '@deepseek-ai/cordis-plugin-hmr', config: { root: [] } })
      }
      await watchUserPatches(ctx, {
        binName: NAME,
        filename: composed.profile.patchPath,
        compose: composeLive,
      })
      await watchUserPatches(ctx, {
        binName: NAME,
        filename: homePatchPath(),
        compose: composeLive,
      })
    } catch (error) {
      suppressShutdownError(ctx, signalShutdown.signal, error)
    }
  }
  return { ctx, shutdown }
}
