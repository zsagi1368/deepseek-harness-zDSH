/**
 * Host-plane governance service over @deepseek-ai/dsh-plugin-governance.
 * Registers the `pluginGovernance` Cordis service and publishes its roster,
 * lifecycle, health, admission, and preset operations as generated direct
 * Remotes for trusted clients.
 * @module @deepseek-ai/dsh-plugin-governance-host
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  DefaultPluginRegistry,
  normalizePluginId,
  PluginPersistence,
  PluginPermissionLevel,
  PluginStatus,
  type Plugin as GovernedPlugin,
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
   * presets; defaults to the governance package's own root (`~/.dsh-dsh`,
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
  }

  /** Create the storage directories up front so misconfiguration fails loud at load. */
  protected [Service.init](): void {
    this.persistence.ensureDirectories()
    this.loadApprovals()
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
   * Deferred: installing a plugin fetches and admits third-party code, which
   * needs the guarded download-and-admit pipeline before it can run for real.
   * @param request - source locator of the plugin to install.
   * @returns always `not-implemented`.
   */
  @Remote('install')
  install(_request: InstallPluginRequest): GovernanceResult<GovernanceAcknowledgement> {
    return failed('not-implemented', 'install awaits the guarded download-and-admit pipeline; mount plugins through the Loader for now')
  }

  /**
   * Deferred: uninstalling removes registered code and its durable state and
   * shares the missing pipeline with `install`.
   * @param request - the plugin to remove.
   * @returns always `not-implemented`, or `plugin-not-found`.
   */
  @Remote('uninstall')
  uninstall(request: PluginIdRequest): GovernanceResult<GovernanceAcknowledgement> {
    const pluginId = canonicalId(request.pluginId)
    if (this.registry.get(pluginId) === null) {
      return failed('plugin-not-found', noSuchPlugin(pluginId))
    }
    return failed('not-implemented', 'uninstall awaits the guarded download-and-admit pipeline; remove plugins through the Loader for now')
  }

  /**
   * Re-enable a previously disabled plugin and snapshot the registry.
   * @param request - the plugin to enable.
   * @returns a receipt, or `plugin-not-found` / `persistence-failed`.
   */
  @Remote('enable')
  async enable(request: PluginIdRequest): Promise<GovernanceResult<GovernanceAcknowledgement>> {
    const pluginId = canonicalId(request.pluginId)
    if (this.registry.get(pluginId) === null) {
      return failed('plugin-not-found', noSuchPlugin(pluginId))
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
    for (const entry of preset.entries) {
      const pluginId = canonicalId(entry.pluginId)
      if (this.registry.get(pluginId) === null) {
        unknown.push(pluginId)
        continue
      }
      if (entry.status === 'disabled') await this.registry.disable(pluginId)
      else await this.registry.enable(pluginId)
      applied.push(pluginId)
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

  // ── internal helpers ──────────────────────────────────────────────────────

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
    const level = manifest.permissionLevel
    const pluginId = canonicalId(manifest.id)
    return Object.freeze({
      pluginId,
      displayName: manifest.name,
      version: manifest.version,
      status: STATUS_NAMES[this.registry.getStatus(pluginId)],
      approvalRequired: manifest.autoApprove !== true
        && (level === undefined
          || level === PluginPermissionLevel.CONFIRM_REQUIRED
          || level === PluginPermissionLevel.SYSTEM),
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

  /** Preset file path for one validated name. */
  private presetPath(name: string): string {
    return join(this.persistence.storagePath, 'presets', `${name}.json`)
  }
}

/** Canonical not-found message for one plugin id. */
function noSuchPlugin(pluginId: PluginGovernanceId): string {
  return `no registered plugin ${JSON.stringify(String(pluginId))}`
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
