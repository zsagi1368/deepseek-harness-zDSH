import type { Branded } from '@deepseek-ai/dsh-brand'

/**
 * Opaque cross-boundary identity of one governed plugin, in the governance
 * spec's canonical `namespace/name` form.
 */
export type PluginGovernanceId = Branded<'PluginGovernanceId'>

/** Wire projection of the governance status vocabulary (`PluginStatus`). */
export type PluginGovernanceStatus =
  | 'active'
  | 'warnings'
  | 'disabled'
  | 'error'
  | 'deprecated'

/** One registered plugin as listed by the governance Remote. */
export interface GovernedPluginSummary {
  readonly pluginId: PluginGovernanceId
  /** Manifest display name. */
  readonly displayName: string
  /** Manifest semver version. */
  readonly version: string
  readonly status: PluginGovernanceStatus
  /**
   * Whether the manifest requests a permission level that needs an explicit
   * user admission decision and has not been auto-approved.
   */
  readonly approvalRequired: boolean
  /** Whether a stored admission decision approves this plugin. */
  readonly approved: boolean
  /** Registry warnings recorded against the plugin; empty when none. */
  readonly warnings: readonly string[]
}

/** Point-in-time roster returned by `list`. */
export interface GovernanceRosterSnapshot {
  readonly plugins: readonly GovernedPluginSummary[]
}

/** Sandbox policy declared by one plugin manifest, projected for clients. */
export interface GovernedSandboxView {
  readonly type: string
  readonly filesystemAccess: string
  readonly networkAccess: string
  /** Whether the manifest claims process spawn/exec rights. */
  readonly maySpawnProcesses: boolean
}

/** One declared capability, projected for clients. */
export interface GovernedCapabilityView {
  readonly type: string
  readonly name: string
}

/** Full client projection of one registered plugin returned by `get`. */
export interface GovernedPluginDetail {
  readonly summary: GovernedPluginSummary
  /** Manifest description, `null` when absent. */
  readonly description: string | null
  /** Manifest author, `null` when absent. */
  readonly author: string | null
  readonly certification: string | null
  readonly permissionLevel: string | null
  readonly capabilities: readonly GovernedCapabilityView[]
  readonly sandbox: GovernedSandboxView
  /** Registry errors recorded against the plugin; empty when none. */
  readonly errors: readonly string[]
}

/** Per-plugin line of the health report. */
export interface GovernedPluginHealthEntry {
  readonly pluginId: PluginGovernanceId
  readonly displayName: string
  readonly status: PluginGovernanceStatus
  /**
   * The plugin's own `getHealthStatus` verdict; `null` when the plugin
   * declares no health probe.
   */
  readonly healthy: boolean | null
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
}

/** Aggregated health report returned by `health`. */
export interface GovernanceHealthReport {
  readonly total: number
  readonly active: number
  readonly warnings: number
  readonly errors: number
  readonly disabled: number
  readonly plugins: readonly GovernedPluginHealthEntry[]
}

/** Stable machine-readable failure category of one governance call. */
export type GovernanceErrorCode =
  | 'plugin-not-found'
  | 'approval-required'
  | 'preset-not-found'
  | 'preset-already-exists'
  | 'not-implemented'
  | 'persistence-failed'
  | 'request-invalid'

/** One failed governance call, carrying its category and remedy hint. */
export interface GovernanceFailure {
  readonly code: GovernanceErrorCode
  /** Correction-oriented message without sensitive values. */
  readonly message: string
}

/** Frozen success/failure envelope every mutating and keyed call returns. */
export type GovernanceResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: GovernanceFailure }

/** Receipt of an accepted mutation. */
export interface GovernanceAcknowledgement {
  readonly acknowledged: boolean
}

/** Outcome of applying one stored preset to the live registry. */
export interface PresetApplicationReport {
  /** Plugins the preset re-enabled or disabled, in preset order. */
  readonly applied: readonly PluginGovernanceId[]
  /** Preset entries naming no registered plugin; left untouched. */
  readonly unknown: readonly PluginGovernanceId[]
}

/** Named arguments shared by every single-plugin endpoint. */
export interface PluginIdRequest {
  readonly pluginId: PluginGovernanceId
}

/** Named arguments of `disable`; the reason lands in the durable snapshot. */
export interface DisablePluginRequest {
  readonly pluginId: PluginGovernanceId
  /** Why the operator disabled the plugin; `null` records no reason. */
  readonly reason: string | null
}

/** Named arguments of the deferred `install` endpoint. */
export interface InstallPluginRequest {
  /** Source locator of the plugin to install; interpreted by a later build. */
  readonly source: string
}

/** Named arguments of the preset endpoints. */
export interface PresetNameRequest {
  /** Preset name; a safe file stem of at most 64 filename characters. */
  readonly name: string
}
