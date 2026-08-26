/**
 * Process-local dynamic Plugin registry and its opaque identity mints.
 * @module @deepseek-ai/dsh-cordis-host-runner/registry
 */

import type { Fiber } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PersistedExportDigests, PersistedPackagePlan } from './export.ts'
import type {
  ApprovalRequestId, CordisDynamicExportId, CordisDynamicPackageId, CordisDynamicPluginId, CordisDynamicPluginRunId,
  CordisDynamicRunMode, DynamicCordisRenderFailure, DynamicCordisRunAttempt,
} from './types.ts'

/** One Host method exposed to this package's Client half. */
export type DynamicCordisHandler = (args: unknown) => Promise<unknown>

/** One live activation and everything its teardown owns. */
export interface DynamicCordisRun {
  /** Exact activation identity. */
  pluginRunId: CordisDynamicPluginRunId
  /** Immutable package version being run. */
  packageId: CordisDynamicPackageId
  /** Host-half Fiber, absent for Client-only packages. */
  fiber?: Fiber
  /** Active Host methods. */
  handlers: Map<string, DynamicCordisHandler>
  /** Method registration cleanup. */
  handlerDisposers: (() => void)[]
  /** Runtime failures already sent to the owning Agent during this activation. */
  reportedRuntimeErrors: Set<string>
  /** Last render failure observed for this version's current run. */
  renderFailure?: DynamicCordisRenderFailure
  /** Approval whose transition started this run, when model-driven. */
  startedForRequest?: ApprovalRequestId
}

/** One immutable package version. */
export interface DynamicCordisDefinition {
  /** Package identity. */
  packageId: CordisDynamicPackageId
  /** Package label. */
  name: string
  /** User-facing purpose. */
  purpose: string
  /** Host source. */
  hostCode?: string
  /** Client source. */
  clientCode?: string
}

/** Stable plugin instance containing immutable package versions. */
export interface DynamicCordisPlugin {
  /** Stable identity. */
  pluginId: CordisDynamicPluginId
  /** Owning session. */
  sessionId: SessionId
  /** Versions in define order. */
  packages: Map<CordisDynamicPackageId, DynamicCordisDefinition>
  /** Client-bearing Packages individually authorized by the user. */
  approvedClientPackages: Set<CordisDynamicPackageId>
  /** Whether one user decision authorized future Package versions of this Plugin. */
  clientVersionUpdatesApproved: boolean
  /** Last successfully activated version. */
  currentPackageId?: CordisDynamicPackageId
  /** Failed or in-progress target version. */
  nextPackageId?: CordisDynamicPackageId
  /** Current activation. */
  run?: DynamicCordisRun
  /** Latest activation attempt, including approval and asynchronous failure state. */
  latestRun?: DynamicCordisRunAttempt
}

/** One suspended model-driven activation. */
export interface DynamicCordisPendingRequest {
  /** Session whose model requested this activation. */
  agentId: SessionId
  pluginId: CordisDynamicPluginId
  packageId: CordisDynamicPackageId
  pluginRunId: CordisDynamicPluginRunId
  mode: CordisDynamicRunMode
  /** Whether this request must wait for an explicit user decision. */
  requiresApproval: boolean
}

/** One persisted-package export waiting for an out-of-band human decision. */
export interface DynamicCordisPendingExport {
  /** Correlation identity answered by the confirming gesture. */
  exportId: CordisDynamicExportId
  /** Session that owns the source bytes. */
  agentId: SessionId
  /** Stable Plugin identity being persisted. */
  pluginId: CordisDynamicPluginId
  /** Immutable Package identity being persisted. */
  packageId: CordisDynamicPackageId
  /**
   * The exact plan whose digests were announced. Confirmation writes this
   * object, so the artifact on disk always matches what the user saw.
   */
  plan: PersistedPackagePlan
  /** Full-length digests over the plan's Host source and manifest. */
  digests: PersistedExportDigests
}

/** Request accepted by `define`; it never crosses the Remote transport. */
export interface DynamicCordisDefineRequest {
  /** Session that owns the plugin. */
  sessionId: SessionId
  /** Create a plugin or append to an existing one. */
  plugin:
    | { kind: 'new'; idPrefix: string }
    | { kind: 'existing'; pluginId: CordisDynamicPluginId }
  /** Package label. */
  name: string
  /** User-facing purpose. */
  purpose: string
  /** At least one source half. */
  code: { host?: string; client?: string }
}

/** Successful `define` result. */
export interface DynamicCordisDefineReceipt {
  pluginId: CordisDynamicPluginId
  packageId: CordisDynamicPackageId
  name: string
  purpose: string
  hasHostHalf: boolean
  hasClientHalf: boolean
}

/** Source-free modification context for an explicit `@pluginId` reference. */
export interface DynamicCordisReference {
  pluginId: CordisDynamicPluginId
  packageId: CordisDynamicPackageId
  name: string
  purpose: string
  currentPackageId?: CordisDynamicPackageId
  nextPackageId?: CordisDynamicPackageId
  activeRun?: { pluginRunId: CordisDynamicPluginRunId; packageId: CordisDynamicPackageId }
  latestRun?: DynamicCordisRunAttempt
}

/** Source-free Plugin summary returned by layered self inspection. */
export interface DynamicCordisPluginInspection extends DynamicCordisReference {
  /** Immutable Package summaries in define order. */
  packages: Array<{
    packageId: CordisDynamicPackageId
    name: string
    purpose: string
    hasHostHalf: boolean
    hasClientHalf: boolean
  }>
}

/** Exact immutable Package metadata and source returned by explicit inspection. */
export interface DynamicCordisPackageInspection extends DynamicCordisReference {
  /** Host and Client function bodies stored for this Package. */
  code: { host?: string; client?: string }
}

/** Registry, identity mints, and pending approval index. */
export class DynamicCordisRegistry {
  private readonly plugins = new Map<CordisDynamicPluginId, DynamicCordisPlugin>()
  private readonly pendingRequests = new Map<ApprovalRequestId, DynamicCordisPendingRequest>()
  private readonly pendingExports = new Map<CordisDynamicExportId, DynamicCordisPendingExport>()
  private nextPlugin = 1
  private nextPackage = 1
  private nextRun = 1
  private nextApproval = 1
  private nextExport = 1

  /**
   * Mint a semantic plugin ID without reusing a prior suffix.
   * @param prefix - validated lowercase semantic prefix proposed by the model.
   * @returns a process-unique Plugin ID.
   */
  mintPluginId(prefix: string): string {
    let id: CordisDynamicPluginId
    do id = `${prefix}-${this.nextPlugin++}` as CordisDynamicPluginId
    while (this.plugins.has(id))
    return id
  }

  /**
   * Mint an immutable package ID.
   * @returns a process-unique Package ID.
   */
  mintPackageId(): string {
    return `pkg-${this.nextPackage++}`
  }

  /**
   * Mint a persisted-export request ID.
   * @returns a process-unique Export request ID.
   */
  mintExportRequestId(): string {
    return `export-${this.nextExport++}`
  }

  /**
   * Mint an activation ID.
   * @returns a process-unique Plugin Run ID.
   */
  mintPluginRunId(): string {
    return `run-${this.nextRun++}`
  }

  /**
   * Mint an approval ID.
   * @returns a process-unique approval request ID.
   */
  mintApprovalRequestId(): string {
    return `approval-${this.nextApproval++}`
  }

  /**
   * Add one stable plugin.
   * @param plugin - Plugin record to retain under its stable ID.
   */
  add(plugin: DynamicCordisPlugin): void {
    this.plugins.set(plugin.pluginId, plugin)
  }

  /**
   * Read one plugin.
   * @param id - stable Plugin ID.
   * @returns the Plugin record, or `undefined` when absent.
   */
  get(id: CordisDynamicPluginId): DynamicCordisPlugin | undefined {
    return this.plugins.get(id)
  }

  /**
   * Delete one plugin and all package versions.
   * @param id - stable Plugin ID to remove.
   * @returns whether a Plugin record was removed.
   */
  delete(id: CordisDynamicPluginId): boolean {
    return this.plugins.delete(id)
  }

  /**
   * Read all plugins in creation order.
   * @returns a snapshot of every Plugin record.
   */
  all(): DynamicCordisPlugin[] {
    return [...this.plugins.values()]
  }

  /**
   * Read one session's plugins in creation order.
   * @param sessionId - owning session to filter by.
   * @returns a snapshot of matching Plugin records.
   */
  ofSession(sessionId: SessionId): DynamicCordisPlugin[] {
    return this.all().filter(plugin => plugin.sessionId === sessionId)
  }

  /**
   * Publish one pending approval.
   * @param id - approval request ID.
   * @param pending - resolver and Plugin metadata retained until settlement.
   */
  armRequest(id: ApprovalRequestId, pending: DynamicCordisPendingRequest): void {
    this.pendingRequests.set(id, pending)
  }

  /**
   * Read one pending approval without claiming it.
   * @param id - approval request ID.
   * @returns the pending request, or `undefined` when absent.
   */
  peekRequest(id: ApprovalRequestId): DynamicCordisPendingRequest | undefined {
    return this.pendingRequests.get(id)
  }

  /**
   * Claim one pending approval; first answer wins.
   * @param id - approval request ID.
   * @returns the claimed request, or `undefined` when already settled.
   */
  claimRequest(id: ApprovalRequestId): DynamicCordisPendingRequest | undefined {
    const pending = this.pendingRequests.get(id)
    if (pending !== undefined) this.pendingRequests.delete(id)
    return pending
  }

  /**
   * Cancel one pending approval.
   * @param id - approval request ID to remove.
   */
  disarmRequest(id: ApprovalRequestId): void {
    this.pendingRequests.delete(id)
  }

  /**
   * Find a pending approval for one Plugin.
   * @param pluginId - stable Plugin ID.
   * @returns its approval request ID, or `undefined` when none is pending.
   */
  pendingRequestFor(pluginId: CordisDynamicPluginId): ApprovalRequestId | undefined {
    for (const [requestId, request] of this.pendingRequests) {
      if (request.pluginId === pluginId) return requestId
    }
    return undefined
  }

  /**
   * Publish one pending export request.
   * @param id - export request ID.
   * @param pending - owner and target identities retained until settlement.
   */
  armExportRequest(id: CordisDynamicExportId, pending: DynamicCordisPendingExport): void {
    this.pendingExports.set(id, pending)
  }

  /**
   * Read one pending export without claiming it.
   * @param id - export request ID.
   * @returns the pending export, or `undefined` when absent.
   */
  peekExportRequest(id: CordisDynamicExportId): DynamicCordisPendingExport | undefined {
    return this.pendingExports.get(id)
  }

  /**
   * Claim one pending export; first answer wins.
   * @param id - export request ID.
   * @returns the claimed export, or `undefined` when already settled.
   */
  claimExportRequest(id: CordisDynamicExportId): DynamicCordisPendingExport | undefined {
    const pending = this.pendingExports.get(id)
    if (pending !== undefined) this.pendingExports.delete(id)
    return pending
  }

  /**
   * Find a pending export for one Plugin regardless of its request ID.
   * @param pluginId - stable Plugin ID.
   * @returns its pending export, or `undefined` when none is pending.
   */
  pendingExportFor(pluginId: CordisDynamicPluginId): DynamicCordisPendingExport | undefined {
    for (const pending of this.pendingExports.values()) {
      if (pending.pluginId === pluginId) return pending
    }
    return undefined
  }

  /**
   * Drop every pending export belonging to one Plugin.
   * @param pluginId - stable Plugin ID whose requests are discarded.
   * @returns the claimed pendings so the caller can announce their cancellation.
   */
  disarmExportsFor(pluginId: CordisDynamicPluginId): DynamicCordisPendingExport[] {
    const dropped: DynamicCordisPendingExport[] = []
    for (const [id, pending] of this.pendingExports) {
      if (pending.pluginId === pluginId) {
        this.pendingExports.delete(id)
        dropped.push(pending)
      }
    }
    return dropped
  }
}
