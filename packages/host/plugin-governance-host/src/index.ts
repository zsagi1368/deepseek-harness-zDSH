/**
 * Host-plane governance service over @deepseek-ai/dsh-plugin-governance.
 * Registers the `pluginGovernance` Cordis service and publishes its roster,
 * lifecycle, health, admission, and preset operations as generated direct
 * Remotes for trusted clients.
 * @module @deepseek-ai/dsh-plugin-governance-host
 */

import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, type Stats } from 'node:fs'
import { dirname, join } from 'node:path'
import { Context, Service, type Fiber, type FiberState } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import {
  DefaultPluginRegistry,
  isCordisPlugin,
  normalizePluginId,
  PluginPersistence,
  PluginPermissionLevel,
  PluginStatus,
  validatePluginId,
  wrapCordisPlugin,
  type CordisService,
  type Plugin as GovernedPlugin,
  type PluginContext as GovernedPluginContext,
  type PluginManifest as GovernedManifest,
  type PluginRegistry,
} from '@deepseek-ai/dsh-plugin-governance'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
// Typert-generated ./typert and ./remote artifacts import Zod at runtime.
import type {} from 'zod'
import type {
  DisablePluginRequest,
  GovernedCapabilityView,
  GovernedPluginDetail,
  GovernedPluginHealthEntry,
  GovernedPluginSummary,
  GovernanceAcknowledgement,
  GovernanceErrorCode,
  GovernanceHealthReport,
  GovernanceResult,
  GovernanceRosterSnapshot,
  InstallPluginRequest,
  PluginGovernanceId,
  PluginGovernanceStatus,
  PluginIdRequest,
  PresetApplicationReport,
  PresetNameRequest,
} from './types.ts'

export type * from './types.ts'

/** Brand an already-validated governance id at this owning boundary. */
function governedId(value: string): PluginGovernanceId {
  return value as PluginGovernanceId
}

/**
 * Normalize a wire or manifest id to the governance spec's canonical
 * `namespace/name` form — the exact key space the registry stores under.
 */
function canonicalId(value: string): PluginGovernanceId {
  return governedId(normalizePluginId(value))
}

/** Runtime mirror: `PluginStatus` is a string enum owned by another package. */
const STATUS_NAMES = {
  [PluginStatus.ACTIVE]: 'active',
  [PluginStatus.WARNINGS]: 'warnings',
  [PluginStatus.DISABLED]: 'disabled',
  [PluginStatus.ERROR]: 'error',
  [PluginStatus.DEPRECATED]: 'deprecated',
} as const satisfies Record<PluginStatus, PluginGovernanceStatus>

/** Runtime mirror: `FiberState` is a cross-package const enum with no runtime object. */
const FIBER_ACTIVE = 2 as FiberState.ACTIVE

/** Minimal read view of one service implementation stored on a mounted fiber. */
interface ProvidedImplementation {
  readonly value?: unknown
}

/** Structural view of the Loader surface this service mirrors from. */
interface MountedEntry {
  readonly options: { group?: boolean | null; name: string }
  readonly disabled?: boolean | null
  readonly fiber?: Fiber
}

interface LoaderLike {
  entries?: () => Iterable<MountedEntry>
}

/** Preset names double as file stems; path separators and dots stay out. */
const PRESET_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** Durable approvals ledger format under the persistence data directory. */
interface PersistedApprovals {
  version: 1
  /** Plugin id to the epoch milliseconds of its recorded admission decision. */
  approvedAt: Record<string, number>
}

/** Durable preset file format under the persistence presets directory. */
interface PersistedPreset {
  version: 1
  savedAt: string
  entries: Array<{ pluginId: string; status: 'active' | 'disabled' }>
}

/** Deployment configuration of the governance service. */
export interface Config {
  /**
   * Persistence root for the registry snapshot, approvals ledger, and
   * presets; defaults to the governance package's own root (`~/.dsh-zdsh`,
   * overridden by `DSH_BRANCH_HOME`).
   */
  storageRoot?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    pluginGovernance: PluginGovernanceGateway
  }
}

/**
 * Frozen success branch of a {@link GovernanceResult}.
 * @param value - business payload carried on the wire.
 */
function succeeded<T>(value: T): GovernanceResult<T> {
  return Object.freeze({ ok: true, value }) as GovernanceResult<T>
}

/**
 * Frozen failure branch of a {@link GovernanceResult}.
 * @param code - stable machine-readable failure category.
 * @param message - correction-oriented message without sensitive values.
 */
function failed(code: GovernanceErrorCode, message: string): GovernanceResult<never> {
  return Object.freeze({ ok: false, error: Object.freeze({ code, message }) })
}

/**
 * The host governance service. It owns one {@link PluginRegistry} and one
 * {@link PluginPersistence} bound to this service fiber; status mutations are
 * snapshotted durably before their receipt is returned, so memory and disk
 * never disagree behind an acknowledged call.
 */
export class PluginGovernanceGateway extends TypertRemoteService {
  /** Loader validation for the persistence root override. */
  static Config: z<Config> = z.object({
    storageRoot: z.string(),
  })

  private readonly registry: PluginRegistry
  private readonly persistence: PluginPersistence
  private readonly approvals: Map<PluginGovernanceId, number> = new Map()
  /**
   * Enable/disable decisions read once at construction from the registry.json
   * snapshot persistence.save writes, keyed canonically. Entries stay queued
   * here until their plugin actually registers, so restarts re-apply them
   * (R1-17) instead of letting every operator decision bounce back to the
   * default status.
   */
  private readonly persistedDecisions = new Map<PluginGovernanceId, 'active' | 'disabled'>()
  /** Canonical ids already mirrored from the Loader, so re-syncs stay idempotent. */
  private readonly mirrored = new Set<PluginGovernanceId>()
  /** In-flight Loader sync; concurrent triggers reuse one pass. */
  private syncing: Promise<void> | null = null

  /**
   * @param ctx - owning Host context.
   * @param config - validated deployment configuration.
   * @param registry - registry backing this service; injection exists for
   * tests, the loader always receives the default in-memory implementation.
   */
  constructor(
    ctx: Context,
    config: Config = {},
    registry: PluginRegistry = new DefaultPluginRegistry(),
  ) {
    super(ctx, 'pluginGovernance')
    if (config.storageRoot !== undefined && config.storageRoot.trim().length === 0) {
      throw new TypeError('plugin-governance: storageRoot must not be blank when provided')
    }
    this.registry = registry
    this.persistence = new PluginPersistence(registry, {
      ...(config.storageRoot === undefined ? {} : { storageRoot: config.storageRoot }),
      autoSave: false,
    })
    // Read the persisted decision snapshot up front (R1-17): every sync pass
    // re-applies it to matching plugins once they register, whether they were
    // injected directly or arrive later through the Loader mirror.
    this.loadPersistedDecisions()
  }

  /** Create storage dirs and run the initial Loader mirror synchronously so the roster holds real data before any Remote read. */
  protected async [Service.init](): Promise<void> {
    this.persistence.ensureDirectories()
    this.loadApprovals()
    // Await the first mirror pass (L2: no async micro-window between service
    // ready and populated roster). Subsequent syncs remain lazy via list().
    await this.syncMountedPlugins()
    this.ctx.effect(() => () => {
      void this.registry.dispose()
    }, 'plugin-governance.registryDispose')
  }

  /**
   * List every registered plugin with its live status and admission state.
   * @returns the point-in-time roster in registration order.
   */
  @Remote('list')
  list(): GovernanceRosterSnapshot {
    // Late-mounting Loader entries land between polls; each roster read gives
    // the mirror one chance to pick them up without making the read async.
    void this.syncMountedPlugins()
    return Object.freeze({
      plugins: Object.freeze(this.registry.getAll().map(plugin => this.summaryOf(plugin))),
    })
  }

  /**
   * Project one registered plugin in full for inspection surfaces.
   * @param request - the plugin to project.
   * @returns the detail, or `plugin-not-found`.
   */
  @Remote('get')
  get(request: PluginIdRequest): GovernanceResult<GovernedPluginDetail> {
    const known = this.requirePlugin(request.pluginId)
    if (!known.ok) return known
    const [, plugin] = known.value
    const manifest = plugin.manifest
    const capabilities: GovernedCapabilityView[] = manifest.capabilities.map(capability => Object.freeze({
      type: capability.type,
      name: capability.tool?.name ?? capability.hook?.name ?? capability.service?.name
        ?? capability.event?.name ?? capability.uiSlot?.name ?? capability.llmAdapter?.name
        ?? capability.type,
    }))
    // Report rows are keyed by the raw manifest id, exactly as the registry's
    // own report builds them; look them up on that same key.
    const errors = this.registry.getHealthReport().plugins
      .find(row => row.id === manifest.id)?.errors ?? []
    return succeeded(Object.freeze({
      summary: this.summaryOf(plugin),
      description: manifest.description ?? null,
      author: manifest.author ?? null,
      certification: manifest.certification?.level ?? null,
      permissionLevel: manifest.permissionLevel ?? null,
      capabilities: Object.freeze(capabilities),
      sandbox: Object.freeze({
        type: manifest.sandbox.type,
        filesystemAccess: manifest.sandbox.filesystem.access,
        networkAccess: manifest.sandbox.network.access,
        maySpawnProcesses: manifest.sandbox.process.spawn || manifest.sandbox.process.exec,
      }),
      errors: Object.freeze(errors),
    }))
  }

  /**
   * Install a plugin from an existing local directory (L3 admission pipeline).
   * The directory must hold a readable `package.json`, from which the
   * governance manifest is constructed — no npm or network download is
   * involved. The constructed manifest is admitted through the governance
   * registry and the roster snapshot persists before the receipt returns.
   *
   * Fail closed: a manifest whose permission posture requests an admission
   * decision (`requiresAdmission`) registers **disabled** unless the approvals
   * ledger already holds a decision, so installed code never runs before the
   * operator approves it; `approve` + `enable` then activate it.
   * @param request - local source directory of the plugin to install.
   * @returns a receipt, or `request-invalid` / `persistence-failed`.
   */
  @Remote('install')
  async install(request: InstallPluginRequest): Promise<GovernanceResult<GovernanceAcknowledgement>> {
    const manifest = manifestFromLocalSource(request.source)
    if (!manifest.ok) return manifest
    const pluginId = canonicalId(manifest.value.id)
    if (this.registry.get(pluginId) !== null) {
      return failed(
        'request-invalid',
        `plugin ${JSON.stringify(String(pluginId))} is already registered; uninstall it first`,
      )
    }
    const plugin: GovernedPlugin = {
      manifest: manifest.value,
      install: () => {},
      uninstall: () => {},
    }
    const registration = await this.registry.register(plugin)
    if (!registration.success) {
      const reasons = (registration.errors ?? []).map(error => `${error.path}: ${error.message}`).join('; ')
      return failed('request-invalid', `the manifest built from package.json was rejected: ${reasons || 'unknown validation failure'}`)
    }
    // Fail-closed admission gate (server-side, mirroring the `enable` remote):
    // registered but disabled until an approval decision exists.
    if (requiresAdmission(plugin) && !this.approvals.has(pluginId)) {
      await this.registry.disable(pluginId, 'installed without a recorded admission decision')
    }
    try {
      this.persistence.save()
    } catch (cause) {
      // Compensate so memory and disk never disagree behind a failed call.
      await this.registry.unregister(pluginId)
      return failed('persistence-failed', `the registry snapshot could not be written: ${describe(cause)}`)
    }
    return succeeded(Object.freeze({ acknowledged: true }))
  }

  /**
   * Uninstall a plugin: unregister it from the governance registry, purge its
   * durable admission state (approvals-ledger entry and queued persisted
   * decision — a later reinstall fails closed instead of inheriting stale
   * grants), and snapshot the registry before the receipt returns. Entries
   * mirrored from the Cordis Loader reappear on the next sync while their
   * module stays mounted in the loader configuration.
   * @param request - the plugin to remove.
   * @returns a receipt, or `plugin-not-found` / `persistence-failed`.
   */
  @Remote('uninstall')
  async uninstall(request: PluginIdRequest): Promise<GovernanceResult<GovernanceAcknowledgement>> {
    const pluginId = canonicalId(request.pluginId)
    const plugin = this.registry.get(pluginId)
    if (plugin === null) {
      return failed('plugin-not-found', noSuchPlugin(pluginId))
    }
    const previousStatus = this.registry.getStatus(pluginId)
    const previousApproval = this.approvals.get(pluginId)
    const previousDecision = this.persistedDecisions.get(pluginId)
    await this.registry.unregister(pluginId)
    this.approvals.delete(pluginId)
    this.persistedDecisions.delete(pluginId)
    try {
      if (previousApproval !== undefined) this.saveApprovals()
      this.persistence.save()
    } catch (cause) {
      // Compensate both maps and the registry, restoring the pre-call status.
      restoreMapEntry(this.approvals, pluginId, previousApproval)
      restoreMapEntry(this.persistedDecisions, pluginId, previousDecision)
      await this.registry.register({ ...plugin })
      if (previousStatus === PluginStatus.DISABLED) await this.registry.disable(pluginId)
      return failed('persistence-failed', `the registry snapshot could not be written: ${describe(cause)}`)
    }
    return succeeded(Object.freeze({ acknowledged: true }))
  }

  /**
   * Re-enable a previously disabled plugin and snapshot the registry. Plugins
   * whose manifest requests an admission decision stay disabled until
   * `approve` records one — the gate is enforced here on the server, not just
   * in client UI.
   * @param request - the plugin to enable.
   * @returns a receipt, or `plugin-not-found` / `approval-required` /
   * `persistence-failed`.
   */
  @Remote('enable')
  async enable(request: PluginIdRequest): Promise<GovernanceResult<GovernanceAcknowledgement>> {
    const known = this.requirePlugin(request.pluginId)
    if (!known.ok) return known
    const [pluginId, plugin] = known.value
    if (requiresAdmission(plugin) && !this.approvals.has(pluginId)) {
      return failed(
        'approval-required',
        `plugin ${JSON.stringify(String(pluginId))} requires an admission decision (approve) before it can be enabled`,
      )
    }
    await this.registry.enable(pluginId)
    return this.persistRegistryChange(() => {
      void this.registry.disable(pluginId)
    })
  }

  /**
   * Disable a plugin and snapshot the registry. An optional reason enters the
   * registry's own per-plugin record until the next enable re-enables it.
   * @param request - the plugin to disable, with an optional reason.
   * @returns a receipt, or `plugin-not-found` / `persistence-failed`.
   */
  @Remote('disable')
  async disable(request: DisablePluginRequest): Promise<GovernanceResult<GovernanceAcknowledgement>> {
    const pluginId = canonicalId(request.pluginId)
    if (this.registry.get(pluginId) === null) {
      return failed('plugin-not-found', noSuchPlugin(pluginId))
    }
    await this.registry.disable(pluginId, request.reason ?? undefined)
    return this.persistRegistryChange(() => {
      void this.registry.enable(pluginId)
    })
  }

  /**
   * Report aggregate and per-plugin health, including each plugin's own probe
   * verdict when it declares one.
   * @returns the aggregated report over the current roster.
   */
  @Remote('health')
  health(): GovernanceHealthReport {
    void this.syncMountedPlugins()
    const report = this.registry.getHealthReport()
    const plugins: GovernedPluginHealthEntry[] = this.registry.getAll().map((plugin) => {
      const pluginId = canonicalId(plugin.manifest.id)
      return {
        pluginId,
        displayName: plugin.manifest.name,
        status: STATUS_NAMES[this.registry.getStatus(pluginId)],
        healthy: this.probeVerdict(pluginId),
        errors: Object.freeze(this.reportErrors(plugin)),
        warnings: Object.freeze(this.registry.getPluginWarnings(pluginId) ?? []),
      }
    })
    return Object.freeze({
      total: report.total,
      active: report.active,
      warnings: report.warnings,
      errors: report.errors,
      disabled: report.disabled,
      plugins: Object.freeze(plugins),
    })
  }

  /**
   * Record the operator's admission decision for a plugin whose manifest
   * requests confirmation. The decision survives restarts in the approvals
   * ledger and is reported by `list` and `get`.
   * @param request - the plugin to approve.
   * @returns a receipt, or `plugin-not-found` / `persistence-failed`.
   */
  @Remote('approve')
  approve(request: PluginIdRequest): GovernanceResult<GovernanceAcknowledgement> {
    const pluginId = canonicalId(request.pluginId)
    if (this.registry.get(pluginId) === null) {
      return failed('plugin-not-found', noSuchPlugin(pluginId))
    }
    const previous = this.approvals.get(pluginId)
    this.approvals.set(pluginId, Date.now())
    try {
      this.saveApprovals()
    } catch (cause) {
      restoreMapEntry(this.approvals, pluginId, previous)
      return failed('persistence-failed', `the approvals ledger could not be written: ${describe(cause)}`)
    }
    return succeeded(Object.freeze({ acknowledged: true }))
  }

  /**
   * Snapshot which plugins are currently enabled or disabled under a preset
   * name. Statuses other than active/disabled are runtime facts rather than
   * operator decisions and stay out of presets.
   * @param request - name of the preset to write.
   * @returns a receipt, or `preset-already-exists` / `request-invalid` /
   * `persistence-failed`.
   */
  @Remote('presetSave')
  presetSave(request: PresetNameRequest): GovernanceResult<GovernanceAcknowledgement> {
    const nameError = checkPresetName(request.name)
    if (nameError !== null) return failed('request-invalid', nameError)
    const path = this.presetPath(request.name)
    if (existsSync(path)) {
      return failed('preset-already-exists', `preset ${JSON.stringify(request.name)} already exists`)
    }
    const entries: PersistedPreset['entries'] = []
    for (const plugin of this.registry.getAll()) {
      const status = this.registry.getStatus(canonicalId(plugin.manifest.id))
      if (status === PluginStatus.ACTIVE || status === PluginStatus.DISABLED) {
        entries.push({
          pluginId: String(canonicalId(plugin.manifest.id)),
          status: status === PluginStatus.DISABLED ? 'disabled' : 'active',
        })
      }
    }
    try {
      writePreset(path, { version: 1, savedAt: new Date().toISOString(), entries })
    } catch (cause) {
      return failed('persistence-failed', `preset ${JSON.stringify(request.name)} could not be written: ${describe(cause)}`)
    }
    return succeeded(Object.freeze({ acknowledged: true }))
  }

  /**
   * Apply a stored preset: re-enable or disable each listed plugin against
   * the live registry. Entries naming unknown plugins are reported untouched.
   * @param request - name of the preset to apply.
   * @returns applied and unknown ids, or `preset-not-found` /
   * `request-invalid` / `persistence-failed`.
   */
  @Remote('presetLoad')
  async presetLoad(request: PresetNameRequest): Promise<GovernanceResult<PresetApplicationReport>> {
    const nameError = checkPresetName(request.name)
    if (nameError !== null) return failed('request-invalid', nameError)
    const path = this.presetPath(request.name)
    if (!existsSync(path)) {
      return failed('preset-not-found', `no preset named ${JSON.stringify(request.name)}`)
    }
    let preset: PersistedPreset
    try {
      preset = readPreset(path)
    } catch (cause) {
      return failed('persistence-failed', `preset ${JSON.stringify(request.name)} could not be read: ${describe(cause)}`)
    }
    const applied: PluginGovernanceId[] = []
    const unknown: PluginGovernanceId[] = []
    /** Previous disabled state per touched id, so IO failure can restore it. */
    const previousDisabled = new Map<PluginGovernanceId, boolean>()
    for (const entry of preset.entries) {
      const pluginId = canonicalId(entry.pluginId)
      if (this.registry.get(pluginId) === null) {
        unknown.push(pluginId)
        continue
      }
      previousDisabled.set(
        pluginId,
        this.registry.getStatus(pluginId) === PluginStatus.DISABLED,
      )
      if (entry.status === 'disabled') await this.registry.disable(pluginId)
      else await this.registry.enable(pluginId)
      applied.push(pluginId)
    }
    // The applied statuses are durable facts like every other mutation: a
    // failed snapshot rolls the live registry back before the failure is
    // reported, so memory and disk never disagree behind an acknowledged call.
    try {
      this.persistence.save()
    } catch (cause) {
      for (const [pluginId, wasDisabled] of [...previousDisabled].reverse()) {
        if (wasDisabled) await this.registry.disable(pluginId)
        else await this.registry.enable(pluginId)
      }
      return failed('persistence-failed', `the registry snapshot could not be written: ${describe(cause)}`)
    }
    return succeeded(Object.freeze({
      applied: Object.freeze(applied),
      unknown: Object.freeze(unknown),
    }))
  }

  /**
   * Delete one stored preset. The live registry is untouched.
   * @param request - name of the preset to delete.
   * @returns a receipt, or `preset-not-found` / `request-invalid` /
   * `persistence-failed`.
   */
  @Remote('presetDelete')
  presetDelete(request: PresetNameRequest): GovernanceResult<GovernanceAcknowledgement> {
    const nameError = checkPresetName(request.name)
    if (nameError !== null) return failed('request-invalid', nameError)
    const path = this.presetPath(request.name)
    if (!existsSync(path)) {
      return failed('preset-not-found', `no preset named ${JSON.stringify(request.name)}`)
    }
    try {
      rmSync(path, { force: false })
    } catch (cause) {
      return failed('persistence-failed', `preset ${JSON.stringify(request.name)} could not be deleted: ${describe(cause)}`)
    }
    return succeeded(Object.freeze({ acknowledged: true }))
  }

  /**
   * Mirror the Cordis Loader's currently mounted plugin entries into the
   * governed registry, so the roster and the plugin-manager UI report real
   * production data instead of an empty list. Each entry is wrapped through
   * the governance Cordis adapter in mirror mode: lifecycle stays owned by
   * Cordis, and the operator's mount decision in the loader configuration
   * counts as the admission decision. One entry failing to wrap or register
   * never blocks the rest; already-mirrored ids are skipped on re-runs.
   *
   * Runs once at service init and is re-triggered by every `list`/`health`
   * read so entries mounted after this service can still appear.
   * @returns when one full sync pass has settled (also a test seam).
   */
  async syncMountedPlugins(): Promise<void> {
    if (this.syncing !== null) return this.syncing
    this.syncing = this.runSyncPass().finally(() => {
      this.syncing = null
    })
    return this.syncing
  }

  // ── internal helpers ──────────────────────────────────────────────────────

  /** One fail-soft pass over the Loader's active entries. */
  private async runSyncPass(): Promise<void> {
    const loader = this.resolveLoader()
    try {
      if (loader !== undefined) {
        for (const entry of loader.entries()) {
          try {
            if (entry.options.group || entry.disabled) continue
            const fiber = entry.fiber
            if (fiber === undefined || fiber.state !== FIBER_ACTIVE) continue
            const pluginId = canonicalId(entry.options.name)
            if (this.mirrored.has(pluginId)) continue
            if (this.registry.get(pluginId) !== null) {
              // Registered by another path (e.g. a test-injected registry): still
              // roster data, and re-registering would only fail as a duplicate.
              this.mirrored.add(pluginId)
              continue
            }
            const service = resolveMountedService(fiber)
            // Entries that provide no object-valued service (plain function or
            // config-only plugins) have no instance to govern; skip them.
            if (service === undefined) continue
            const result = await this.registry.register(wrapCordisPlugin(
              service as CordisService,
              mirrorPluginContext(String(pluginId)),
              { id: String(pluginId), name: mountedDisplayName(entry.options.name), mirror: true },
            ))
            this.mirrored.add(pluginId)
            if (!result.success) {
              this.warn(`failed to register loader entry ${entry.options.name}: ${(result.errors ?? []).map(error => error.message).join('; ')}`)
            }
          } catch (cause) {
            // Fail soft: one broken entry must not blank out the rest of the roster.
            this.warn(`failed to mirror loader entry ${entry.options.name}: ${describe(cause)}`)
          }
        }
      }
    } catch (cause) {
      // Fail soft: the enumeration itself (entries() or a mid-pass next())
      // throwing must not abort the pass or its persisted-decision sweep.
      this.warn(`failed to enumerate loader entries: ${describe(cause)}`)
    }
    // Every pass ends by re-applying persisted decisions, so entries that just
    // registered through the Loader above come back with their operator
    // decisions instead of a fresh default status.
    await this.restorePersistedDecisions()
  }

  /** The Loader service when one is present on this context, else `undefined`. */
  private resolveLoader(): (LoaderLike & { entries: () => Iterable<MountedEntry> }) | undefined {
    // Context property access resolves through the reflection layer and THROWS
    // for names nothing provides, so contexts without a Loader must be probed,
    // not read directly. The untrusted-face cast keeps presence probing honest:
    // the declared context face may claim a Loader the runtime never mounted.
    try {
      const candidate = (this.ctx as unknown as Partial<Record<'loader', LoaderLike>>).loader
      if (candidate === undefined) return undefined
      const entries = candidate.entries
      if (typeof entries !== 'function') return undefined
      return candidate as LoaderLike & { entries: () => Iterable<MountedEntry> }
    } catch {
      return undefined
    }
  }

  /** Non-fatal sync diagnostics go through the host logger, never to callers. */
  private warn(message: string): void {
    this.ctx.logger.warn('plugin-governance: %s', message)
  }

  /** Fail unless the id names a registered plugin, returning its canonical form. */
  private requirePlugin(pluginId: PluginGovernanceId): GovernanceResult<readonly [PluginGovernanceId, GovernedPlugin]> {
    const id = canonicalId(pluginId)
    const plugin = this.registry.get(id)
    if (plugin === null) return failed('plugin-not-found', noSuchPlugin(id))
    return succeeded([id, plugin] as const)
  }

  /** Build the list-line projection for one plugin. */
  private summaryOf(plugin: GovernedPlugin): GovernedPluginSummary {
    const manifest = plugin.manifest
    const pluginId = canonicalId(manifest.id)
    return Object.freeze({
      pluginId,
      displayName: manifest.name,
      version: manifest.version,
      status: STATUS_NAMES[this.registry.getStatus(pluginId)],
      // Entries mirrored from the Loader are distinguishable from native
      // registrations so the UI can badge their provenance.
      source: this.mirrored.has(pluginId) ? 'loader-mirror' : 'native',
      approvalRequired: requiresAdmission(plugin),
      approved: this.approvals.has(pluginId),
      warnings: Object.freeze(this.registry.getPluginWarnings(pluginId) ?? []),
    })
  }

  /**
   * Registry errors for one plugin. Report rows are keyed by the raw
   * manifest id, exactly as the registry's own report builds them, so the
   * lookup uses that key instead of the canonical form.
   */
  private reportErrors(plugin: GovernedPlugin): readonly string[] {
    return this.registry.getHealthReport().plugins
      .find(row => row.id === plugin.manifest.id)?.errors ?? []
  }

  /** Read one plugin's own health probe, `null` when it declares none. */
  private probeVerdict(pluginId: PluginGovernanceId): boolean | null {
    const verdict = this.registry.get(pluginId)?.getHealthStatus?.()
    return verdict === undefined ? null : verdict.healthy
  }

  /**
   * Snapshot the registry after a status mutation; on IO failure undo the
   * mutation, so a receipt is only ever sent when memory and disk agree.
   */
  private persistRegistryChange(undo: () => void): GovernanceResult<GovernanceAcknowledgement> {
    try {
      this.persistence.save()
    } catch (cause) {
      undo()
      return failed('persistence-failed', `the registry snapshot could not be written: ${describe(cause)}`)
    }
    return succeeded(Object.freeze({ acknowledged: true }))
  }

  /** Approvals ledger path inside the persistence data directory. */
  private get approvalsPath(): string {
    return join(this.persistence.dataDir, 'approvals.json')
  }

  /** Hydrate the approvals ledger once at init. */
  private loadApprovals(): void {
    if (!existsSync(this.approvalsPath)) return
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.approvalsPath, 'utf8')) as unknown
    } catch {
      // A corrupt or half-written ledger carries no decisions worth keeping:
      // admission reverts to unapproved, which fails closed for every plugin.
      return
    }
    if (!isRecord(parsed) || !isRecord(parsed.approvedAt)) return
    for (const [id, at] of Object.entries(parsed.approvedAt)) {
      if (typeof at === 'number' && Number.isFinite(at)) this.approvals.set(canonicalId(id), at)
    }
  }

  /** Write the approvals ledger; throws so the caller can compensate. */
  private saveApprovals(): void {
    const payload: PersistedApprovals = { version: 1, approvedAt: {} }
    for (const [id, at] of this.approvals) payload.approvedAt[String(id)] = at
    mkdirSync(this.persistence.dataDir, { recursive: true })
    writeFileSync(this.approvalsPath, JSON.stringify(payload, null, 2))
  }

  /**
   * Read the persisted enable/disable decisions once at construction (R1-17).
   * The registry.json snapshot that persistence.save writes carries each
   * plugin's last acknowledged status; reading it here is what makes a restart
   * honor those decisions instead of silently resetting them. The file layout
   * and narrowing discipline mirror persistence.load's, extended with the
   * per-entry `status` field that API leaves out. A missing or corrupt
   * snapshot carries no decisions worth keeping: restore stays a no-op (fail
   * closed to the registry's own defaults).
   */
  private loadPersistedDecisions(): void {
    if (!existsSync(this.persistence.registryPath)) return
    let parsed: unknown
    try {
      parsed = JSON.parse(readFileSync(this.persistence.registryPath, 'utf8')) as unknown
    } catch {
      return
    }
    if (!isRecord(parsed) || !Array.isArray(parsed.plugins)) return
    for (const entry of parsed.plugins) {
      if (!isRecord(entry) || typeof entry.id !== 'string') continue
      if (entry.status === 'active' || entry.status === 'disabled') {
        this.persistedDecisions.set(canonicalId(entry.id), entry.status)
      }
    }
  }

  /**
   * Re-apply persisted decisions to every registered plugin they name. Each id
   * applies once and then leaves the queue, so later passes never clobber live
   * operator decisions made during this session; ids whose plugin has not
   * registered yet stay queued until a future pass sees them mount. Only
   * disables are enforced: a fresh process registers everything active by
   * default, and force-re-enabling here would bypass the server-side admission
   * gate the `enable` remote enforces.
   */
  private async restorePersistedDecisions(): Promise<void> {
    for (const [pluginId, decision] of [...this.persistedDecisions]) {
      if (this.registry.get(pluginId) === null) continue
      this.persistedDecisions.delete(pluginId)
      if (decision !== 'disabled') continue
      try {
        if (this.registry.getStatus(pluginId) !== PluginStatus.DISABLED) {
          await this.registry.disable(pluginId)
        }
      } catch (cause) {
        this.warn(`failed to restore persisted disabled state for ${String(pluginId)}: ${describe(cause)}`)
      }
    }
  }

  /** Preset file path for one validated name. */
  private presetPath(name: string): string {
    return join(this.persistence.storagePath, 'presets', `${name}.json`)
  }
}

/** Canonical not-found message for one plugin id. */
function noSuchPlugin(pluginId: PluginGovernanceId): string {
  return `no registered plugin ${JSON.stringify(String(pluginId))}`
}

/**
 * Deny-all sandbox defaults behind a manifest built from a plain package.json:
 * until the plugin's own `dsh.sandbox` section declares otherwise it gets no
 * network, no process rights, and read-only filesystem access.
 */
function denyAllSandbox(): GovernedManifest['sandbox'] {
  return {
    type: 'inline',
    resources: { memoryLimitMb: 256, cpuLimit: 50, timeoutMs: 30000, maxOutputBytes: 10_000 },
    filesystem: { access: 'readonly', allowedPaths: [], deniedPatterns: [] },
    network: { access: 'none', allowedHosts: [], deniedHosts: [], allowLocal: false },
    environment: { whitelist: [], blacklist: [], clear: false },
    process: { spawn: false, exec: false, allowedCommands: [] },
  }
}

/**
 * Read one local plugin directory and construct a governance manifest from
 * its package.json (L3 admission pipeline). Identity comes from the standard
 * npm fields (`name` normalized into the canonical `namespace/name` key space,
 * `version`); an optional embedded `dsh` section may declare compatibility,
 * permission posture, capabilities, and sandbox; everything undeclared falls
 * back to fail-closed defaults. Every unreadable or under-specified source
 * surfaces as `request-invalid`.
 */
function manifestFromLocalSource(source: unknown): GovernanceResult<GovernedManifest> {
  if (typeof source !== 'string' || source.trim().length === 0) {
    return failed('request-invalid', 'install requires the local plugin directory path in source')
  }
  let stats: Stats | undefined
  try {
    stats = statSync(source, { throwIfNoEntry: false })
  } catch {
    stats = undefined
  }
  if (stats === undefined || !stats.isDirectory()) {
    return failed(
      'request-invalid',
      `the install source ${JSON.stringify(source)} is not an existing local directory`,
    )
  }
  const packagePath = join(source, 'package.json')
  if (!existsSync(packagePath)) {
    return failed('request-invalid', 'the install source carries no package.json; a readable plugin manifest is required')
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(packagePath, 'utf8')) as unknown
  } catch (cause) {
    return failed('request-invalid', `package.json could not be parsed: ${describe(cause)}`)
  }
  if (!isRecord(parsed)) {
    return failed('request-invalid', 'package.json is not a JSON object')
  }
  const rawName = typeof parsed.name === 'string' ? parsed.name.trim() : ''
  const id = normalizePluginId(rawName)
  if (!validatePluginId(id)) {
    return failed(
      'request-invalid',
      `package.json name ${JSON.stringify(rawName)} does not normalize to a valid governance plugin id (namespace/name)`,
    )
  }
  const version = typeof parsed.version === 'string' ? parsed.version.trim() : ''
  if (!/^\d+\.\d+\.\d+/.test(version)) {
    return failed('request-invalid', `package.json version ${JSON.stringify(version)} is not a semver string`)
  }
  // Optional embedded governance section; unrecognized content stays out.
  const dsh = isRecord(parsed.dsh) ? parsed.dsh : {}
  const capabilities: GovernedManifest['capabilities'] = Array.isArray(dsh.capabilities)
    ? (dsh.capabilities.filter(entry => isRecord(entry)) as unknown as GovernedManifest['capabilities'])
    : []
  const manifest: GovernedManifest = {
    id,
    version,
    name: typeof parsed.displayName === 'string' && parsed.displayName.trim().length > 0
      ? parsed.displayName
      : rawName,
    ...(typeof parsed.description === 'string' ? { description: parsed.description } : {}),
    ...(typeof parsed.author === 'string' ? { author: parsed.author } : {}),
    dsh: {
      compatible: typeof dsh.compatible === 'string' && dsh.compatible.trim().length > 0
        ? dsh.compatible
        : '>=0.0.0',
    },
    capabilities,
    ...(typeof dsh.permissionLevel === 'string'
      ? { permissionLevel: dsh.permissionLevel as PluginPermissionLevel }
      : {}),
    ...(typeof dsh.autoApprove === 'boolean' ? { autoApprove: dsh.autoApprove } : {}),
    sandbox: isRecord(dsh.sandbox) ? (dsh.sandbox as unknown as GovernedManifest['sandbox']) : denyAllSandbox(),
  }
  return succeeded(manifest)
}

/**
 * Whether one manifest's permission posture asks for an explicit admission
 * decision. Shared by the roster projection and the server-side `enable` gate,
 * so what the UI displays is exactly what the service enforces.
 */
function requiresAdmission(plugin: GovernedPlugin): boolean {
  const level = plugin.manifest.permissionLevel
  return plugin.manifest.autoApprove !== true
    && (level === undefined
      || level === PluginPermissionLevel.CONFIRM_REQUIRED
      || level === PluginPermissionLevel.SYSTEM)
}

/**
 * Pick the mounted instance to govern from one active fiber: prefer a value
 * that looks like a Cordis service (start/health surface), else the first
 * object-valued implementation the fiber provided.
 */
function resolveMountedService(fiber: Fiber): unknown {
  const store = fiber.store as Record<string, ProvidedImplementation | undefined> | undefined
  if (store === undefined) return undefined
  let fallback: unknown
  for (const implementation of Object.values(store)) {
    const value = implementation?.value
    if (value === null || typeof value !== 'object') continue
    if (isCordisPlugin(value)) return value
    fallback ??= value
  }
  return fallback
}

/** Display name for a mounted module specifier (`@scope/pkg` → `pkg`). */
function mountedDisplayName(moduleName: string): string {
  const segments = moduleName.split('/')
  return segments[segments.length - 1] ?? moduleName
}

/**
 * Minimal governance-spec context used only to construct mirrored wrappers.
 * The registry substitutes its own context for install/uninstall; this one
 * just carries a logger so adapter diagnostics land somewhere visible.
 */
function mirrorPluginContext(pluginId: string): GovernedPluginContext {
  return {
    services: new Map(),
    emit: () => {},
    on: () => () => {},
    once: () => () => {},
    off: () => {},
    config: {},
    setConfig: () => {},
    getConfig: <T>(_key: string, defaultValue?: T): T => defaultValue as T,
    effect: () => {},
    onDispose: () => {},
    logger: {
      info: (message) => { console.log(`[governed ${pluginId}] ${message}`) },
      warn: (message) => { console.warn(`[governed ${pluginId}] ${message}`) },
      error: (message) => { console.error(`[governed ${pluginId}] ${message}`) },
      debug: () => {},
    },
    status: PluginStatus.ACTIVE,
    setWarnings: () => {},
    markDeprecated: () => {},
    sandbox: {
      exec: () => Promise.resolve({ exitCode: 0, stdout: '', stderr: '', duration: 0 }),
      read: () => Promise.resolve(''),
      write: () => Promise.resolve(),
      list: () => Promise.resolve([]),
    },
    registerCapability: () => {},
    unregisterCapability: () => {},
  }
}

/** Restore a Map entry removed or overwritten by a compensated operation. */
function restoreMapEntry<K, V>(map: Map<K, V>, key: K, previous: V | undefined): void {
  if (previous === undefined) map.delete(key)
  else map.set(key, previous)
}

/** Validate one preset name against the file-stem grammar. */
function checkPresetName(name: string): string | null {
  if (PRESET_NAME_PATTERN.test(name)) return null
  return 'preset name must be 1-64 letters, digits, underscores, or hyphens'
}

/** Read and narrow one preset file; throws on unreadable or foreign content. */
function readPreset(path: string): PersistedPreset {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8')) as unknown
  if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
    throw new TypeError('not a v1 governance preset')
  }
  const entries: PersistedPreset['entries'] = []
  for (const entry of parsed.entries) {
    if (!isRecord(entry) || typeof entry.pluginId !== 'string') continue
    if (entry.status !== 'active' && entry.status !== 'disabled') continue
    entries.push({ pluginId: entry.pluginId, status: entry.status })
  }
  return { version: 1, savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '', entries }
}

/** Write one preset file, creating the presets directory on first use. */
function writePreset(path: string, payload: PersistedPreset): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(payload, null, 2))
}

/** Narrow one parsed JSON document to a plain-object view. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/** One-line cause rendering for failure messages, without stack noise. */
function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export default PluginGovernanceGateway
