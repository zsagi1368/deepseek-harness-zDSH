/**
 * Models settings page store: one snapshot joining the configurable-provider
 * directory (`llm.providers`), the settings namespaces (shared settings mirror),
 * and the referenced credentials (`credentials.describe`). The host stays the
 * single fact source — every mutation writes through the wire and the page
 * re-renders from the next describe, pushed or refetched.
 */

import type {
  ConfigurableProviderView, CredentialView, IApiClient, SettingsNamespaceView,
} from '@deepseek-ai/dsh-api-remotes/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { SettingsDescribeFace } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { en } from './locales.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'

/**
 * Any route key walks a dict schema to the same profile node, so the lookup
 * names one that cannot collide with a configured route.
 */
const PROBE_ROUTE = '\u0000probe'

/**
 * The settings namespace carrying the editable slot policy. Kept as a string
 * here rather than importing the host-side `@deepseek-ai/dsh-model-slots`
 * (whose `MODEL_SLOTS_SETTINGS_NAMESPACE` registers the same value), because
 * that package is not client-bundle-safe; the two literals must stay in sync.
 */
export const MODEL_SLOTS_SETTINGS_NAMESPACE = 'llm-model-slots'

/** The built-in slots this page renders, in display order. */
export const SLOT_ROWS = ['title', 'compaction.summarize', 'vision'] as const

/** One slot's effective route as the page shows it, with its provenance tier. */
export interface EffectiveSlotView {
  /** Slot identity (`title`, `compaction.summarize`, `vision`). */
  readonly slot: string
  /** Resolved provider route, when a deployment statement provides one. */
  readonly provider: string | undefined
  /** Resolved model id, when a deployment statement provides one. */
  readonly model: string | undefined
  /** The tier that produced the route shown. */
  readonly source: 'slot' | 'deployment-default' | 'main-route'
}

/** One provider row the page renders. */
export interface ProviderRow {
  /** The directory entry (route id, display name, settings address, live state). */
  entry: ConfigurableProviderView
  /** Whether any layer configures this provider (its profile resolves). */
  configured: boolean
  /** Whether the user layer alone carries the profile (removal restores the base). */
  removable: boolean
  /** The credential reference the resolved profile names, when one does. */
  apiKeyEnv: string | undefined
  /** Credential state for {@link apiKeyEnv}, once described. */
  credential: CredentialView | undefined
}

/** Page snapshot. */
export interface ModelsSettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  /** Whole-load failure text; row-level write failures stay in the editor. */
  error: string | null
  /** Credential enrichment failure; provider/settings rows remain usable. */
  credentialError: string | null
  /** Whether the settings provider accepts writes. */
  writable: boolean
  /** Every configurable provider joined with its configured/credential state. */
  rows: readonly ProviderRow[]
  /** Namespace views by ns, for the editor's schema/layers/secrets. */
  namespaces: ReadonlyMap<string, SettingsNamespaceView>
}

/**
 * Human text for a rejected wire call. A transport failure rejects with an
 * Error; a host or a runtime can reject with anything, and the page still has
 * to say something.
 * @param error - the rejection value.
 * @returns the message to show.
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Derive the conventional credential reference for a provider route: the v1
 * page never asks for an environment-variable name, so a typed key stores
 * under this derived reference and the profile records it as `apiKeyEnv`.
 * @param provider - provider route id (e.g. `anthropic`, `minimax-cn`).
 * @returns the derived reference name (e.g. `MINIMAX_CN_API_KEY`).
 */
export function deriveKeyRef(provider: string): string {
  return `${provider.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`
}

/** One slot-config value carried by the `llm-model-slots` settings namespace. */
interface SlotConfigEntry {
  provider?: unknown
  model?: unknown
  apiKeyEnv?: unknown
}

/** Read one route entry, tolerating every shape a layered settings value may hold. */
function routeEntryOf(value: unknown): { provider: string | undefined; model: string | undefined } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { provider: undefined, model: undefined }
  }
  const entry = value as SlotConfigEntry
  return {
    provider: typeof entry.provider === 'string' && entry.provider.length > 0 ? entry.provider : undefined,
    model: typeof entry.model === 'string' && entry.model.length > 0 ? entry.model : undefined,
  }
}

/**
 * Compute the effective route and provenance tier for every built-in slot
 * from the `llm-model-slots` namespace value, following the fixed precedence
 * the slot registry resolves: explicit slot statement, then the deployment
 * default, then the conversation's own main-model route (which a settings
 * page cannot name, so it renders as a tier without a fixed route).
 * @param value - the namespace's resolved value, or `undefined` when absent.
 * @returns one row per built-in slot in display order.
 */
export function effectiveSlotViews(value: unknown): EffectiveSlotView[] {
  const root = (typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value
    : {}) as { slots?: unknown; fallback?: unknown }
  const slots = (typeof root.slots === 'object' && root.slots !== null && !Array.isArray(root.slots)
    ? root.slots
    : {}) as Record<string, unknown>
  const fallback = routeEntryOf(root.fallback)
  return SLOT_ROWS.map((slot) => {
    const own = routeEntryOf(slots[slot])
    if (own.provider !== undefined && own.model !== undefined) {
      return { slot, provider: own.provider, model: own.model, source: 'slot' as const }
    }
    if (fallback.provider !== undefined && fallback.model !== undefined) {
      return { slot, provider: fallback.provider, model: fallback.model, source: 'deployment-default' as const }
    }
    return { slot, provider: undefined, model: undefined, source: 'main-route' as const }
  })
}

/** One model-capability probe the vision editor may use before writing. */
export interface VisionModelProbe {
  /**
   * Resolve one exact provider/model route and read its input modalities.
   * Absent when the client API exposes no such probe; the page then cannot
   * verify capability and stores the statement as written.
   * @param provider - provider route id.
   * @param model - provider-owned model id.
   * @param signal - optional abort signal.
   * @returns the resolved model metadata, or a rejection the page reports.
   */
  resolveModelInfo?(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<{ inputModalities?: readonly string[] }>
}

/**
 * Whether the proposed vision route can actually read images, checked with
 * the same `inputModalities` fact the read-image gate enforces — moved to
 * config-save time so a text-only model is refused before it is stored.
 * A missing probe defers to the runtime gate (no static rejection); a probe
 * that answers `undefined` modalities cannot confirm image input and is
 * treated as unverified (refused), matching the read-image gate's negative
 * reading of an explicit omission.
 * @param provider - proposed provider route id.
 * @param model - proposed model id.
 * @param probe - the optional capability probe.
 * @returns a copy key when the route must be refused, or `undefined` to save.
 */
export async function visionModelImageError(
  provider: string,
  model: string,
  probe: VisionModelProbe,
): Promise<keyof typeof en | undefined> {
  if (probe.resolveModelInfo === undefined) return undefined
  let modalities: readonly string[] | undefined
  try {
    const info = await probe.resolveModelInfo(provider, model)
    modalities = info.inputModalities
  } catch {
    // A transport or adapter rejection means the page cannot verify the
    // model; the write stays refused so a text-only model never slips in.
    return 'visionModelUnverified'
  }
  return modalities === undefined || !modalities.includes('image') ? 'visionModelImageRequired' : undefined
}

/**
 * The wire protocols a hand-declared route may name, read out of the owning
 * namespace's own schema. This stays a schema read rather than a wire field so
 * the choices the page offers cannot drift from the ones the adapter accepts:
 * both come from the same `Config`.
 * @param namespace - the namespace view whose schema declares the profile shape.
 * @param schema - settings schema operations.
 * @returns the protocol identifiers, or an empty list when the schema has none.
 */
export function protocolChoices(
  namespace: SettingsNamespaceView | undefined,
  schema: SettingsSchemaOperations,
): string[] {
  if (namespace === undefined) return []
  const node = schema.nodeAtPath(schema.rehydrate(namespace.schema), ['providers', PROBE_ROUTE, 'api'])
  const list = (node as { type?: string; list?: readonly { value?: unknown }[] } | undefined)
  if (list?.type !== 'union' || list.list === undefined) return []
  return list.list.map(entry => entry.value).filter((value): value is string => typeof value === 'string')
}

/**
 * The reasoning efforts a pi-ai profile may name as its route default, read out
 * of the owning namespace's own schema — the same union the adapter's
 * `Config.providers.*.reasoning` accepts. A schema read keeps the offered
 * levels pinned to what the adapter validates, exactly like
 * {@link protocolChoices}.
 * @param namespace - the namespace view whose schema declares the profile shape.
 * @param schema - settings schema operations.
 * @returns the effort level names, or an empty list when the schema has none.
 */
export function reasoningEffortChoices(
  namespace: SettingsNamespaceView | undefined,
  schema: SettingsSchemaOperations,
): string[] {
  if (namespace === undefined) return []
  const node = schema.nodeAtPath(schema.rehydrate(namespace.schema), ['providers', PROBE_ROUTE, 'reasoning'])
  const list = (node as { type?: string; list?: readonly { value?: unknown }[] } | undefined)
  if (list?.type !== 'union' || list.list === undefined) return []
  return list.list.map(entry => entry.value).filter((value): value is string => typeof value === 'string')
}

/** Localized option labels this page ships for the known effort levels. */
const EFFORT_LABEL_KEYS = {
  off: 'effortOff',
  minimal: 'effortMinimal',
  low: 'effortLow',
  medium: 'effortMedium',
  high: 'effortHigh',
  xhigh: 'effortXhigh',
  max: 'effortMax',
} as const satisfies Record<string, keyof typeof en>

/**
 * Localized option label for one schema-reported effort level. The list itself
 * is a schema read, so an adapter that adds a level before this page learns it
 * still renders — spelled with its raw wire name.
 * @param level - the level name from the adapter's schema union.
 * @returns its copy key, or undefined when this build has no label for it.
 */
export function reasoningEffortKey(level: string): keyof typeof en | undefined {
  return level in EFFORT_LABEL_KEYS
    ? EFFORT_LABEL_KEYS[level as keyof typeof EFFORT_LABEL_KEYS]
    : undefined
}

/** The credential reference a resolved profile names (its `apiKeyEnv` field). */
function apiKeyEnvOf(
  namespace: SettingsNamespaceView | undefined,
  path: readonly string[],
  schema: SettingsSchemaOperations,
): string | undefined {
  if (namespace === undefined) return undefined
  const profile = schema.getPath(namespace.value, path)
  if (typeof profile !== 'object' || profile === null) return undefined
  const ref = (profile as { apiKeyEnv?: unknown }).apiKeyEnv
  return typeof ref === 'string' && ref.length > 0 ? ref : undefined
}

/** The models settings page controller (one per settings surface). */
export class ModelsSettingsStore {
  /** The snapshot the section renders from (uSES-safe store). */
  readonly store: SnapshotStore<ModelsSettingsState> = createSnapshotStore<ModelsSettingsState>({
    status: 'idle', error: null, credentialError: null, writable: false, rows: [], namespaces: new Map(),
  })

  /** Latest load wins; an older response never overwrites a newer one. */
  private generation = 0

  /**
   * @param api - the wire face (credentials/llm domains, and settings writes).
   * @param describeFace - the shared mirror's describe face (namespace views and writability).
   */
  constructor(
    private readonly api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>,
    private readonly schema: SettingsSchemaOperations,
    private readonly describeFace: SettingsDescribeFace,
  ) {}

  /**
   * Refresh the whole page snapshot: the provider directory and the mirror's
   * settings answer in parallel, then one batched credential describe over
   * every referenced ref. Provider failure or absence of an initial settings
   * answer keeps the last good rows and surfaces an error; a failed settings
   * refresh reuses the mirror's held view.
   * @returns nothing; the snapshot carries the outcome.
   */
  async load(): Promise<void> {
    const generation = ++this.generation
    this.store.update((s) => { s.status = 'loading'; s.error = null })
    let providers: ConfigurableProviderView[]
    let writable: boolean
    let views: readonly SettingsNamespaceView[]
    try {
      const [providersResponse] = await Promise.all([
        this.api.llm.providers({}),
        this.describeFace.ensure(),
      ])
      if (!providersResponse.result.ok) throw new Error(providersResponse.result.error.message)
      const mirrored = this.describeFace.getSnapshot()
      if (mirrored.view === undefined) {
        throw new Error(mirrored.error ?? 'settings are unavailable in this browser')
      }
      providers = providersResponse.result.value.providers
      writable = mirrored.view.writable
      views = mirrored.view.namespaces
    } catch (error) {
      if (generation !== this.generation) return
      this.store.update((s) => {
        s.status = 'error'
        s.error = error instanceof Error ? error.message : String(error)
      })
      return
    }
    const namespaces = new Map(views.map(view => [view.ns, view]))
    const rows: ProviderRow[] = providers.map((entry) => {
      const namespace = namespaces.get(entry.settingsNs)
      const configured = namespace !== undefined
        && (entry.settingsPath.length === 0 || this.schema.getPath(namespace.value, entry.settingsPath) !== undefined)
      const removable = namespace !== undefined
        && entry.settingsPath.length > 0
        && this.schema.hasPath(namespace.user, entry.settingsPath)
        && !this.schema.hasPath(namespace.base, entry.settingsPath)
      return {
        entry,
        configured,
        removable,
        apiKeyEnv: apiKeyEnvOf(namespace, entry.settingsPath, this.schema),
        credential: undefined,
      }
    })
    const refs = [...new Set(rows.flatMap(row => row.apiKeyEnv === undefined ? [] : [row.apiKeyEnv]))]
    let credentials: Record<string, CredentialView> = {}
    let credentialError: string | null = null
    if (refs.length > 0) {
      try {
        const response = await this.api.credentials.describe({ refs })
        // Credential state is an enrichment for the Models page: neither a
        // business rejection nor a transport failure fails the load. The
        // onboarding projection below retains the failure distinction.
        if (response.result.ok) credentials = response.result.value.credentials
        else credentialError = response.result.error.message
      } catch (error) {
        credentialError = messageOf(error)
      }
    }
    if (generation !== this.generation) return
    this.store.update((s) => {
      s.status = 'ready'
      s.error = null
      s.credentialError = credentialError
      s.writable = writable
      s.rows = rows.map(row => ({
        ...row,
        ...row.apiKeyEnv !== undefined && credentials[row.apiKeyEnv] !== undefined
          ? { credential: credentials[row.apiKeyEnv] }
          : {},
      }))
      s.namespaces = namespaces
    })
  }
}

/**
 * Whether a joined row can serve model requests as it stands: the route is
 * registered with the adapter registry, and whatever credential its resolved
 * profile names is stored. A profile naming no reference authenticates through
 * the provider's own path (the Bedrock chain, Vertex ADC, a gateway that needs
 * nothing), as does a live route with no settings address at all, so neither
 * owes this page a key.
 * @param row - one joined provider row.
 * @returns whether the user already has this provider to talk to.
 */
export function providerUsable(row: ProviderRow): boolean {
  if (!row.entry.active) return false
  if (row.apiKeyEnv === undefined) return true
  return row.credential?.configured === true
}

/** First-run onboarding readiness derived only from the shared Models join. */
export type OnboardingReadiness =
  | { kind: 'loading' }
  | { kind: 'adapter-absent' }
  | { kind: 'provider-ready' }
  | { kind: 'credential-missing' }
  | {
    kind: 'unavailable'
    reason:
      | 'load-failed'
      | 'provider-inactive'
      | 'credentials-unavailable'
      | 'settings-read-only'
      | 'credential-read-only'
  }

/**
 * Project first-run readiness from the provider/settings/credential join used
 * by the Models page. The step exists to leave the user with a model to talk
 * to, so ANY usable provider ends it; only when none exists does the official
 * DeepSeek route — the one route the prompt can offer a key field for — decide
 * whether prompting can help. A missing official configurable-provider
 * declaration means the adapter is not repairable by navigating to Models.
 * @param state - current shared Models join snapshot.
 * @returns the onboarding state without reading a parallel fact source.
 */
export function onboardingReadiness(state: ModelsSettingsState): OnboardingReadiness {
  if ((state.status === 'idle' || state.status === 'loading') && state.rows.length === 0) {
    return { kind: 'loading' }
  }
  if (state.status === 'error') {
    return {
      kind: 'unavailable',
      reason: 'load-failed',
    }
  }
  if (state.rows.some(providerUsable)) return { kind: 'provider-ready' }
  const row = state.rows.find(candidate =>
    candidate.entry.provider === 'deepseek-official'
    && candidate.entry.settingsNs === 'llm-deepseek'
    && candidate.entry.settingsPath.length === 0)
  if (row === undefined) return { kind: 'adapter-absent' }
  if (!row.entry.active) {
    return {
      kind: 'unavailable',
      reason: 'provider-inactive',
    }
  }
  // Past the usable gate an active route names a reference it has no stored
  // credential for, so the remaining questions are all about that credential.
  if (state.credentialError !== null || row.credential === undefined) {
    return {
      kind: 'unavailable',
      reason: 'credentials-unavailable',
    }
  }
  if (!state.writable) {
    return {
      kind: 'unavailable',
      reason: 'settings-read-only',
    }
  }
  if (!row.credential.writable) {
    return {
      kind: 'unavailable',
      reason: 'credential-read-only',
    }
  }
  return { kind: 'credential-missing' }
}
