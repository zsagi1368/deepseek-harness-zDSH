# 扩展

[English](extensions.md) | 中文

extensions 子系统允许 agent（智能体）定义带版本的 Cordis 包、运行其 host 与浏览器两半，并在编写代码前查询获准公开的运行时元数据。包生命周期与沙箱行为由 [`packages/extensions`](../../packages/extensions/README.zh.md) 包组说明。

<!-- BEGIN GENERATED cordis-surface (gen-cordis-catalog.ts) — do not edit between markers -->

<a id="cordis-surface"></a>

## Cordis API

Generated from source by `scripts/gen-cordis-catalog.ts` (verified fresh by `pnpm run verify-cordis-catalog` in doc-sync; regenerate with `pnpm run gen-cordis-catalog`) — the language sides differ only in locale-specific paired document paths. Signature blocks use a `ts cordis-catalog` fence and keep the original source JSDoc; dispatch modes are defined in the [primer](../cordis-primer.zh.md#dispatch-modes), and the framework-inherited `ctx` API lives in [cordis-api/inherited.md](../cordis-api/inherited.md).

<a id="ctxagentmemory--agentmemoryservice"></a>

### `ctx.agentMemory` — `AgentMemoryService`

The `agentMemory` service: extraction intake, persistence ownership, and the prompt-time scorer behind the registered `agent:memory` section.

```ts cordis-catalog
/**
 * Ingest one session event: human prompts feed the decision/preference
 * rules; a completed turn's final assistant reply feeds the fact rule.
 * @param session - the session the event belongs to.
 * @param event - the session event to observe.
 */
async observe(session: Session, event: SessionEvent): Promise<void>

/**
 * Render the `agent:memory` section text for one prompt assembly: Top-K
 * keyword-overlap entries against the assembling agent's current task.
 * Returns `''` when no agent is attached or nothing overlaps.
 * @param assemble - the prompt assembly context carrying the agent to score.
 * @returns the rendered section text (possibly empty).
 */
renderSection(assemble: AssembleContext): string

/**
 * Every stored entry, oldest first (future UI/Remote read face).
 * @returns the stored memory entries, oldest first.
 */
list(): Promise<MemoryEntry[]>

/**
 * Drop one stored entry by id.
 * @param id - the entry id to forget.
 * @returns whether the id existed.
 */
forget(id: string): Promise<boolean>

/** Eagerly load persisted shards so prompt-time scoring sees them before the first turn. */
start(): Promise<void>

/** Await pending persistence (disposal seam). */
drain(): Promise<void>
```

Types: [AssembleContext](system-prompt.zh.md) · [Session](session.zh.md) · [SessionEvent](session.zh.md)

Source: [`packages/memory/zdsh-memory/src/index.ts`](../../packages/memory/zdsh-memory/src/index.ts)

<a id="ctxcordisinspect--cordisinspectregistryservice"></a>

### `ctx.cordisInspect` — `CordisInspectRegistryService`

Registry and cross-page router behind the two model-facing inspect tools.

```ts cordis-catalog
/**
 * Register one Host provider.
 * @param registration - manifest and local query handler.
 * @returns idempotent disposer.
 */
register(registration: HostCordisInspectProviderRegistration): () => void

/**
 * Replace the mirrored Client provider directory.
 * @param providers - complete Client manifest snapshot.
 */
syncClientManifest(providers: readonly CordisInspectProviderManifest[]): void

/**
 * Return the complete known Host and Client provider directory.
 * @returns Host providers followed by the Client providers.
 */
list(): CordisInspectProviderView[]

/**
 * Execute one provider query on its owning platform.
 * @param platform - Host or Client runtime.
 * @param providerId - provider selected from {@link list}.
 * @param methodName - declared method name.
 * @param input - optional lossless JSON input.
 * @param agent - requesting Agent and scope.
 * @param signal - tool-call cancellation.
 * @returns provider JSON data.
 */
async query( platform: CordisInspectPlatform, providerId: string, methodName: string, input: JsonValue | undefined, agent: Agent, signal: AbortSignal, ): Promise<JsonValue>

/**
 * Accept the first valid Client response for a pending query.
 * @param agent - Agent whose Session owns the query.
 * @param requestId - Pending Client query identity.
 * @param resolution - Client provider result or failure.
 * @returns whether this response settled the still-pending query.
 */
resolveClientQuery( agent: Agent, requestId: CordisInspectRequestId, resolution: CordisInspectQueryResolution, ): CordisInspectResolveAck
```

Types: [Agent](core.zh.md)

Source: [`packages/extensions/cordis-host-runner/src/inspect-registry.ts`](../../packages/extensions/cordis-host-runner/src/inspect-registry.ts)

<a id="ctxdynamiccordisrunner--dynamiccordisrunnerservice"></a>

### `ctx.dynamicCordisRunner` — `DynamicCordisRunnerService`

Dynamic Plugin registry and Host-half lifecycle.

```ts cordis-catalog
/**
 * Define a new Plugin's first Package or append a Package to an existing Plugin.
 * @param request - Session ownership, Plugin selection, metadata, and source code.
 * @returns Host-minted Plugin and Package identities with declared-half metadata.
 */
define(request: DynamicCordisDefineRequest): DynamicCordisDefineReceipt

/**
 * Remove a Plugin, its active run, and all immutable Packages.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity to remove.
 * @returns Whether removal succeeded and whether it stopped an active run.
 */
async undefine(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisUndefineReceipt>

/**
 * Remove a Plugin from the user panel and queue the resulting state change for the model's next step.
 * @param agent - Agent whose Session owns the Plugin and receives the context.
 * @param pluginId - Stable Plugin identity to remove.
 * @returns Whether removal succeeded and whether it stopped an active run.
 */
@Remote('undefineFromPanel') async undefineFromPanel(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisUndefineReceipt>

/**
 * Start or update one Package for a model tool call. An unauthorized Client
 * Package waits for approval; Plugin-wide authorization covers later versions.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity to activate.
 * @param packageId - Immutable Package version to activate.
 * @param mode - Whether to run the current version or switch versions.
 * @param signal - Tool-call cancellation signal while the activation request is being created.
 * @returns The successful activation identity or an actionable refusal.
 */
async run( agent: Agent, pluginId: CordisDynamicPluginId, packageId: CordisDynamicPackageId, mode: CordisDynamicRunMode, signal?: AbortSignal, ): Promise<DynamicCordisRunResponse>

/**
 * Start Host code for an approved request or a direct panel gesture.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity to activate.
 * @param packageId - Immutable Package version to activate.
 * @param mode - Whether to run the current version or switch versions.
 * @param requestId - Model-driven request identity, or null for a direct user gesture.
 * @param approveFutureVersions - Whether this approval covers later Packages of the same Plugin.
 * @returns The exact Host activation or a failure message.
 */
@Remote('runHostHalf') async runHostHalf( agent: Agent, pluginId: CordisDynamicPluginId, packageId: CordisDynamicPackageId, mode: CordisDynamicRunMode, requestId: ApprovalRequestId | null, approveFutureVersions: boolean, ): Promise<DynamicCordisHostHalfResult>

/**
 * Fetch Client code for the exact active run.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity to read.
 * @param pluginRunId - Exact active run authorized to receive source.
 * @returns Client source and its Plugin, Package, and run identities.
 */
@Remote('getClientCode') getClientCode( agent: Agent, pluginId: CordisDynamicPluginId, pluginRunId: CordisDynamicPluginRunId, ): DynamicCordisClientSource

/**
 * Resolve one model-driven Client activation request.
 * @param requestId - Request identity to settle once.
 * @param resolution - Browser refusal or exact Client activation result.
 * @returns Whether the still-pending request accepted this resolution.
 */
@Remote('resolveRequestRun') async resolveRequestRun( requestId: ApprovalRequestId, resolution: DynamicCordisRunResolution, ): Promise<DynamicCordisResolveAck>

/**
 * Settle a direct panel run after this page loaded or failed its Client half.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity being settled.
 * @param resolution - Exact Client activation result from the acting page.
 * @returns The committed activation or its failure.
 */
@Remote('settleUserRun') async settleUserRun( agent: Agent, pluginId: CordisDynamicPluginId, resolution: DynamicCordisRunResolution, ): Promise<DynamicCordisRunResponse>

/**
 * Stop the active run while retaining every Package version.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity to stop.
 * @returns Success or the reason no run was stopped.
 */
async stop(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisStopResponse>

/**
 * Stop a Plugin from the user panel and queue the resulting state change for the model's next step.
 * @param agent - Agent whose Session owns the Plugin and receives the context.
 * @param pluginId - Stable Plugin identity to stop.
 * @returns Success or the reason no run was stopped.
 */
@Remote('stopFromPanel') async stopFromPanel(agent: Agent, pluginId: CordisDynamicPluginId): Promise<DynamicCordisStopResponse>

/**
 * Replace the Host mirror of the Client inspect provider directory.
 * @param providers - complete Client provider manifest.
 * @returns null after accepting the manifest.
 */
@Remote('syncInspectManifest') syncInspectManifest(providers: readonly CordisInspectProviderManifest[]): null

/**
 * Claim one pending Client inspect query with its live result.
 * @param agent - Session that owns the query.
 * @param requestId - exact pending query identity.
 * @param resolution - provider result or structured refusal.
 * @returns whether this answer won the query.
 */
@Remote('resolveInspectQuery') resolveInspectQuery( agent: Agent, requestId: CordisInspectRequestId, resolution: CordisInspectQueryResolution, ): CordisInspectResolveAck

/**
 * Frame-wide inventory, grouped as one row per stable Plugin.
 * @returns Source-free metadata for every process-local Plugin.
 */
@Remote('inventory') inventory(): DynamicCordisInventoryRow[]

/**
 * Read one Session's Host-rich state for inspection and result rendering.
 * @param agent - Agent whose Session selects visible Plugins.
 * @returns Plugin versions, active runs, Host fibers, and render failures.
 */
snapshot(agent: Agent): DynamicCordisSnapshotRow[]

/**
 * Read source-free context for an explicit `@pluginId` user gesture.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity referenced by the user.
 * @returns The preferred modification base, or undefined when unavailable.
 */
reference(agent: Agent, pluginId: CordisDynamicPluginId): DynamicCordisReference | undefined

/**
 * List source-free Plugin summaries owned by one Session.
 * @param agent - Agent whose Session selects visible Plugins.
 * @returns one summary per Plugin in creation order.
 */
listPlugins(agent: Agent): DynamicCordisPluginInspection[]

/**
 * Inspect one Plugin without returning Package source.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - stable Plugin identity.
 * @returns version pointers, latest run, and all Package summaries.
 */
inspectPlugin(agent: Agent, pluginId: CordisDynamicPluginId): DynamicCordisPluginInspection

/**
 * Read one exact immutable Package and its Host and Client source.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity that owns the Package.
 * @param packageId - Exact immutable Package identity to inspect.
 * @returns Package metadata, source, and the Plugin's lifecycle pointers.
 */
inspectPackage( agent: Agent, pluginId: CordisDynamicPluginId, packageId: CordisDynamicPackageId, ): DynamicCordisPackageInspection

/**
 * Record a post-load render failure for the exact active run.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity that rendered.
 * @param pluginRunId - Exact active run that produced the failure.
 * @param failure - Slot, message, and entry-retirement result.
 * @returns Null after recording or ignoring a stale report.
 */
@Remote('reportRenderFailure') async reportRenderFailure( agent: Agent, pluginId: CordisDynamicPluginId, pluginRunId: CordisDynamicPluginRunId, failure: DynamicCordisRenderFailure, ): Promise<null>

/**
 * Report a Client guard rejection that happened after the Package completed activation.
 * @param agent - Agent whose Session must own the Plugin.
 * @param pluginId - Stable Plugin identity whose Client code was rejected.
 * @param pluginRunId - Exact active run that produced the rejection.
 * @param failure - Original guard message and stack.
 * @returns Null after reporting or ignoring a stale/startup failure.
 */
@Remote('reportClientGuardFailure') async reportClientGuardFailure( agent: Agent, pluginId: CordisDynamicPluginId, pluginRunId: CordisDynamicPluginRunId, failure: CordisErrorDetails, ): Promise<null>

/**
 * Invoke an active Host method while rejecting stale Client runs.
 * @param pluginId - Stable Plugin identity that owns the method.
 * @param pluginRunId - Exact active run authorizing the call.
 * @param method - Registered Host handler name.
 * @param args - JSON argument delivered to the handler.
 * @returns The JSON result or a typed invocation failure.
 */
@Remote('invoke') async invoke( pluginId: CordisDynamicPluginId, pluginRunId: CordisDynamicPluginRunId, method: string, args: JsonValue, ): Promise<DynamicCordisInvokeResult>
```

Types: [Agent](core.zh.md)

Source: [`packages/extensions/cordis-host-runner/src/index.ts`](../../packages/extensions/cordis-host-runner/src/index.ts)

<a id="ctxplugingovernance--plugingovernancegateway"></a>

### `ctx.pluginGovernance` — `PluginGovernanceGateway`

The host governance service. It owns one PluginRegistry and one PluginPersistence bound to this service fiber; status mutations are snapshotted durably before their receipt is returned, so memory and disk never disagree behind an acknowledged call.

```ts cordis-catalog
/**
 * List every registered plugin with its live status and admission state.
 * @returns the point-in-time roster in registration order.
 */
@Remote('list') list(): GovernanceRosterSnapshot

/**
 * Project one registered plugin in full for inspection surfaces.
 * @param request - the plugin to project.
 * @returns the detail, or `plugin-not-found`.
 */
@Remote('get') get(request: PluginIdRequest): GovernanceResult<GovernedPluginDetail>

/**
 * Install a plugin from a local directory or an npm registry source (L3
 * admission pipeline). Local sources must be existing directories with a
 * readable `package.json`; `npm:<name>[@<exact-version>]` sources are
 * resolved against the configured registry, integrity-checked, and
 * extracted into the governance storage area before the same manifest
 * construction runs over them. The constructed manifest is admitted
 * through the governance registry and the roster snapshot persists before
 * the receipt returns.
 *
 * Fail closed: a manifest whose permission posture requests an admission
 * decision (`requiresAdmission`) registers **disabled** unless the approvals
 * ledger already holds a decision, so installed code never runs before the
 * operator approves it; `approve` + `enable` then activate it.
 * @param request - local source directory or `npm:` spec of the plugin.
 * @returns a receipt, or `request-invalid` / `registry-unavailable` /
 * `persistence-failed`.
 */
@Remote('install') async install(request: InstallPluginRequest): Promise<GovernanceResult<GovernanceAcknowledgement>>

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
@Remote('uninstall') async uninstall(request: PluginIdRequest): Promise<GovernanceResult<GovernanceAcknowledgement>>

/**
 * Re-enable a previously disabled plugin and snapshot the registry. Plugins
 * whose manifest requests an admission decision stay disabled until
 * `approve` records one — the gate is enforced here on the server, not just
 * in client UI.
 * @param request - the plugin to enable.
 * @returns a receipt, or `plugin-not-found` / `approval-required` /
 * `persistence-failed`.
 */
@Remote('enable') async enable(request: PluginIdRequest): Promise<GovernanceResult<GovernanceAcknowledgement>>

/**
 * Disable a plugin and snapshot the registry. An optional reason enters the
 * registry's own per-plugin record until the next enable re-enables it.
 * @param request - the plugin to disable, with an optional reason.
 * @returns a receipt, or `plugin-not-found` / `persistence-failed`.
 */
@Remote('disable') async disable(request: DisablePluginRequest): Promise<GovernanceResult<GovernanceAcknowledgement>>

/**
 * Report aggregate and per-plugin health, including each plugin's own probe
 * verdict when it declares one.
 * @returns the aggregated report over the current roster.
 */
@Remote('health') health(): GovernanceHealthReport

/**
 * Record the operator's admission decision for a plugin whose manifest
 * requests confirmation. The decision survives restarts in the approvals
 * ledger and is reported by `list` and `get`.
 * @param request - the plugin to approve.
 * @returns a receipt, or `plugin-not-found` / `persistence-failed`.
 */
@Remote('approve') approve(request: PluginIdRequest): GovernanceResult<GovernanceAcknowledgement>

/**
 * Snapshot which plugins are currently enabled or disabled under a preset
 * name. Statuses other than active/disabled are runtime facts rather than
 * operator decisions and stay out of presets.
 * @param request - name of the preset to write.
 * @returns a receipt, or `preset-already-exists` / `request-invalid` /
 * `persistence-failed`.
 */
@Remote('presetSave') presetSave(request: PresetNameRequest): GovernanceResult<GovernanceAcknowledgement>

/**
 * Apply a stored preset: re-enable or disable each listed plugin against
 * the live registry. Entries naming unknown plugins are reported untouched.
 * @param request - name of the preset to apply.
 * @returns applied and unknown ids, or `preset-not-found` /
 * `request-invalid` / `persistence-failed`.
 */
@Remote('presetLoad') async presetLoad(request: PresetNameRequest): Promise<GovernanceResult<PresetApplicationReport>>

/**
 * Delete one stored preset. The live registry is untouched.
 * @param request - name of the preset to delete.
 * @returns a receipt, or `preset-not-found` / `request-invalid` /
 * `persistence-failed`.
 */
@Remote('presetDelete') presetDelete(request: PresetNameRequest): GovernanceResult<GovernanceAcknowledgement>

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
async syncMountedPlugins(): Promise<void>
```

Source: [`packages/host/plugin-governance-host/src/index.ts`](../../packages/host/plugin-governance-host/src/index.ts)

<a id="cordis-events"></a>

### `cordis/*` events

<a id="cordisdynamic-package--emit"></a>

#### `cordis/dynamic-package` — emit

One exact Plugin/Package activation is now live in the Host.

```ts cordis-catalog
/**
 * One exact Plugin/Package activation is now live in the Host.
 * @param pkg - stable plugin, immutable package, run identity, and label.
 * @mode emit
 */
'cordis/dynamic-package'(pkg: DynamicCordisPackage): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="cordisdynamic-retract--emit"></a>

#### `cordis/dynamic-retract` — emit

One exact activation was withdrawn.

```ts cordis-catalog
/**
 * One exact activation was withdrawn.
 * @param retracted - plugin, package, and run identity.
 * @mode emit
 */
'cordis/dynamic-retract'(retracted: DynamicCordisRetracted): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="cordisinspect-query--emit"></a>

#### `cordis/inspect-query` — emit

Request a live read-only query from the Client inspect registry.

```ts cordis-catalog
/**
 * Request a live read-only query from the Client inspect registry.
 * @param request - correlation, Session, provider, method, and JSON input.
 * @mode emit
 */
'cordis/inspect-query'(request: CordisInspectQueryRequest): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="cordisinspect-query-resolved--emit"></a>

#### `cordis/inspect-query-resolved` — emit

Notify every Client that an inspect query has settled or been cancelled.

```ts cordis-catalog
/**
 * Notify every Client that an inspect query has settled or been cancelled.
 * @param resolved - exact query identity that is no longer answerable.
 * @mode emit
 */
'cordis/inspect-query-resolved'(resolved: CordisInspectQueryResolved): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="cordisrequest-run--emit"></a>

#### `cordis/request-run` — emit

A Client-bearing activation needs a browser page, and may require a user decision.

```ts cordis-catalog
/**
 * A Client-bearing activation needs a browser page, and may require a user decision.
 * @param request - correlation identity, owner, target version, mode, and approval requirement.
 * @mode emit
 */
'cordis/request-run'(request: DynamicCordisRunRequest): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)

<a id="cordisrequest-run-resolved--emit"></a>

#### `cordis/request-run-resolved` — emit

A pending Client activation request left the answerable state.

```ts cordis-catalog
/**
 * A pending Client activation request left the answerable state.
 * @param resolved - request identity and outcome.
 * @mode emit
 */
'cordis/request-run-resolved'(resolved: DynamicCordisRequestResolved): void
```

Source: [`packages/extensions/cordis-host-runner/src/types.ts`](../../packages/extensions/cordis-host-runner/src/types.ts)
<!-- END GENERATED cordis-surface -->
