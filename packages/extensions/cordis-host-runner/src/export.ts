/**
 * Persisted-package exporter: turns one immutable dynamic Package into a
 * manifest-plugin artifact on disk. The plan is built and digested from the
 * registry's immutable bytes, but nothing is written until a human confirms
 * the exact digest out of band — the model can only ever initiate.
 * @module @deepseek-ai/dsh-cordis-host-runner/export
 */

import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'

/**
 * First-party trust namespace for persisted artifacts. Every export lands
 * under `user-persisted/<dynamicPluginId>` so the future boot scanner can
 * trust-label the whole namespace as user-confirmed instead of parsing
 * per-artifact provenance.
 */
export const PERSISTED_NAMESPACE = 'user-persisted'

/** Fixed semver floor for persisted artifacts; the boot audit owns real gating. */
const PERSISTED_COMPATIBLE = '>=0.0.0'

/** Entry file that carries the verbatim Host-half source. */
export const PERSISTED_ENTRY_FILE = 'host.js'

/** Manifest file written beside the entry. */
export const PERSISTED_MANIFEST_FILE = 'package.json'

/** Segment grammar for namespace/name path pieces: no separators, dots, or traversal. */
const SEGMENT_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/i

/** Provenance recorded inside the artifact's `dsh.persisted` section. */
export interface PersistedProvenance {
  /** Monotonic re-export counter; 1 on first persist of this plugin id. */
  rev: number
  /** Session that defined the source bytes. */
  originSession: string
  /** Stable dynamic Plugin identity the bytes came from. */
  originPluginId: string
  /** Immutable dynamic Package identity the bytes came from. */
  originPackageId: string
  /** When the confirmation was honored, as an ISO timestamp. */
  exportedAt: string
}

/** sha256 digests over exactly the bytes this export persists. */
export interface PersistedExportDigests {
  /** Digest of the verbatim Host-half source. */
  host: string
  /** Digest of the canonical manifest JSON (the parsed object's stable form). */
  manifest: string
}

/**
 * Everything needed to materialize one persisted artifact. Plans are plain
 * data so they can be summarized in a confirmation event, verified again at
 * confirm time, and written by the single writer in this module.
 */
export interface PersistedPackagePlan {
  /** Governance id the artifact will register under (`user-persisted/<name>`). */
  persistedId: string
  /** Directory suffix below the configured root: `<namespace>/<name>`. */
  dirSuffix: string
  /** Package label carried into `displayName`. */
  name: string
  /** User-facing purpose carried into `description`. */
  purpose: string
  /** Verbatim Host-half source; digested and written byte-for-byte. */
  hostCode: string
  /** Manifest version derived from the re-export revision. */
  version: string
  /** Provenance embedded in the manifest. */
  provenance: PersistedProvenance
}

/** What a previous artifact at the same target looks like to the requester. */
export interface ExistingPersistedArtifact {
  /** Previous re-export revision, or null when the existing file is unreadable or foreign. */
  rev: number | null
  /** Session recorded by the previous artifact, when readable. */
  originSession?: string
}

/** Narrow an unknown value to a record view. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Check one path segment for safe use inside the persistence root.
 * @param raw - candidate segment such as a dynamic plugin id.
 * @returns whether the segment is non-empty, short, and free of separators or traversal.
 */
export function isSafePersistedSegment(raw: string): boolean {
  return SEGMENT_PATTERN.test(raw)
}

/**
 * Derive the governance id for one dynamic plugin's persisted artifact.
 * @param pluginId - stable dynamic Plugin id (for example `probe-12`).
 * @returns the canonical `user-persisted/<sanitized>` governance id.
 * @throws when the dynamic id cannot be embedded in a path safely.
 */
export function persistedIdFor(pluginId: string): string {
  if (!isSafePersistedSegment(pluginId)) {
    throw new Error(`dynamic plugin "${pluginId}" cannot be persisted: the id must be 1-64 letters, digits, hyphens, or underscores`)
  }
  return `${PERSISTED_NAMESPACE}/${pluginId}`
}

/**
 * Hash a string with sha256 and return the full hex digest.
 * @param value - exact bytes to digest.
 * @returns the lowercase hex sha256 digest.
 */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * Build the durable export plan for one committed dynamic package. The plan
 * fixes the manifest content, target paths, and digests at request time so
 * the confirmation dialog and the later disk write can never disagree.
 *
 * The generated manifest always declares an explicit deny-all sandbox and a
 * confirm-required permission level: persistence grants nothing a fresh
 * manifest plugin would not get, and the boot audit plus an explicit enable
 * stay mandatory before any code runs.
 * @param input - identities, metadata, verbatim source bytes, and the next re-export rev.
 * @returns the immutable plan later passed to {@link writePersistedPackage}.
 * @throws when the plugin id cannot form a safe path segment.
 */
export function buildPersistedPackagePlan(input: {
  pluginId: string
  packageId: string
  sessionId: string
  name: string
  purpose: string
  hostCode: string
  rev: number
}): PersistedPackagePlan {
  if (!isSafePersistedSegment(input.pluginId)) {
    throw new Error(`dynamic plugin "${input.pluginId}" cannot be persisted: the id must be 1-64 letters, digits, hyphens, or underscores`)
  }
  return {
    persistedId: `${PERSISTED_NAMESPACE}/${input.pluginId}`,
    dirSuffix: join(PERSISTED_NAMESPACE, input.pluginId),
    name: input.name,
    purpose: input.purpose,
    hostCode: input.hostCode,
    version: `0.1.${input.rev}`,
    provenance: {
      rev: input.rev,
      originSession: input.sessionId,
      originPluginId: input.pluginId,
      originPackageId: input.packageId,
      exportedAt: new Date().toISOString(),
    },
  }
}

/**
 * Compute the digests for one plan: the Host source itself plus the canonical
 * JSON of the manifest that will be written. Display surfaces show a prefix;
 * the full values are what confirm-time verification compares.
 * @param plan - the plan to digest.
 * @returns both full-length sha256 digests.
 */
export function digestPersistedPlan(plan: PersistedPackagePlan): PersistedExportDigests {
  return {
    host: sha256Hex(plan.hostCode),
    manifest: sha256Hex(JSON.stringify(buildManifestObject(plan))),
  }
}

/**
 * Build the exact manifest object written as `package.json`. Exported so the
 * digester, validator, and tests all see one rendering.
 * @param plan - the plan to render.
 * @returns the manifest as a plain JSON-ready object.
 */
export function buildManifestObject(plan: PersistedPackagePlan): Record<string, unknown> {
  return {
    name: plan.persistedId,
    version: plan.version,
    displayName: plan.name,
    description: plan.purpose,
    main: `./${PERSISTED_ENTRY_FILE}`,
    dsh: {
      compatible: PERSISTED_COMPATIBLE,
      // Fail-closed posture: the operator must approve and enable after a
      // restart before any persisted code executes.
      permissionLevel: 'confirm-required',
      capabilities: [
        {
          type: 'service',
          service: { name: sanitizeCapabilityName(plan.name), factory: `./${PERSISTED_ENTRY_FILE}`, singleton: true },
        },
      ],
      sandbox: {
        type: 'inline',
        resources: { memoryLimitMb: 256, cpuLimit: 50, timeoutMs: 30000, maxOutputBytes: 10000 },
        filesystem: { access: 'readonly', allowedPaths: [], deniedPatterns: [] },
        network: { access: 'none', allowedHosts: [], deniedHosts: [], allowLocal: false },
        environment: { whitelist: [], blacklist: [], clear: true },
        process: { spawn: false, exec: false, allowedCommands: [] },
      },
      persisted: { ...plan.provenance },
      origin: 'user-persisted',
    },
  }
}

/**
 * Reduce arbitrary package metadata to a service-capability name.
 * @param raw - display label supplied at define time.
 * @returns a lowercase identifier safe as a service name.
 */
function sanitizeCapabilityName(raw: string): string {
  const cleaned = raw.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned.length > 0 ? cleaned.slice(0, 48) : 'persisted-service'
}

/**
 * Deny-all fallback for documents without an explicit sandbox; kept structurally
 * identical to the admission posture the governance host applies on install.
 * @returns the fail-closed sandbox block.
 */
function denyAllSandbox(): Record<string, unknown> {
  return {
    type: 'inline',
    resources: { memoryLimitMb: 256, cpuLimit: 50, timeoutMs: 30000, maxOutputBytes: 10000 },
    filesystem: { access: 'readonly', allowedPaths: [], deniedPatterns: [] },
    network: { access: 'none', allowedHosts: [], deniedHosts: [], allowLocal: false },
    environment: { whitelist: [], blacklist: [], clear: true },
    process: { spawn: false, exec: false, allowedCommands: [] },
  }
}

/**
 * Project a rendered `package.json` document into the runtime governance
 * manifest shape (`id`, top-level `capabilities` and `sandbox`). This mirrors
 * how the governance admission pipeline reads local installs, so boot-time
 * loading of a persisted artifact sees exactly this object.
 * @param document - the parsed package.json contents.
 * @returns the runtime manifest, or null when the document lacks identity.
 */
export function toGovernanceManifest(document: unknown): Record<string, unknown> | null {
  if (!isRecord(document)) return null
  const rawName = typeof document.name === 'string' ? document.name.trim() : ''
  const id = rawName.startsWith('@') ? rawName.slice(1) : rawName
  if (!id.includes('/')) return null
  const dsh = isRecord(document.dsh) ? document.dsh : {}
  const displayName = typeof document.displayName === 'string' && document.displayName.trim().length > 0
    ? document.displayName
    : rawName
  return {
    id,
    ...(typeof document.version === 'string' ? { version: document.version } : {}),
    name: displayName,
    ...(typeof document.description === 'string' ? { description: document.description } : {}),
    dsh: {
      compatible: typeof dsh.compatible === 'string' && dsh.compatible.length > 0 ? dsh.compatible : PERSISTED_COMPATIBLE,
    },
    capabilities: Array.isArray(dsh.capabilities) ? dsh.capabilities : [],
    sandbox: isRecord(dsh.sandbox) ? dsh.sandbox : denyAllSandbox(),
    ...(typeof dsh.permissionLevel === 'string' ? { permissionLevel: dsh.permissionLevel } : {}),
  }
}

/**
 * Validate a rendered persisted manifest against the fields the governance
 * loader requires before anything reaches disk. This mirrors the admission
 * contract at the write boundary: an artifact we would refuse to load must
 * never be produced.
 * @param manifest - the rendered manifest about to be written.
 * @returns null when the manifest is loadable-shaped, otherwise a refusal message.
 */
export function validatePersistedManifest(manifest: unknown): string | null {
  if (!isRecord(manifest)) return 'the persisted manifest is not an object'
  if (typeof manifest.name !== 'string' || !manifest.name.includes('/')) {
    return 'the persisted manifest lacks a namespace/name id'
  }
  if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
    return 'the persisted manifest lacks a semver version'
  }
  const dsh = isRecord(manifest.dsh) ? manifest.dsh : undefined
  if (dsh === undefined || typeof dsh.compatible !== 'string' || dsh.compatible.length === 0) {
    return 'the persisted manifest lacks dsh.compatible'
  }
  if (!Array.isArray(dsh.capabilities) || dsh.capabilities.length === 0) {
    return 'the persisted manifest declares no capabilities'
  }
  const sandbox = dsh.sandbox
  if (!isRecord(sandbox) || typeof sandbox.type !== 'string' || sandbox.type.length === 0) {
    return 'the persisted manifest lacks an explicit sandbox declaration'
  }
  if (!['process', 'worker', 'inline'].includes(sandbox.type)) {
    return `the persisted sandbox type ${JSON.stringify(sandbox.type)} is not loadable`
  }
  const limits = isRecord(sandbox.resources) ? sandbox.resources : undefined
  if (limits === undefined || typeof limits.memoryLimitMb !== 'number' || limits.memoryLimitMb <= 0
    || typeof limits.timeoutMs !== 'number' || limits.timeoutMs <= 0) {
    return 'the persisted sandbox lacks positive resource limits'
  }
  return null
}

/**
 * Read any previous artifact at a plan's target, for display in the
 * confirmation summary before an overwrite is confirmed.
 * @param rootDir - configured persistence root.
 * @param plan - the incoming plan whose target is inspected.
 * @returns what is known about the existing artifact, or undefined when none exists.
 */
export function inspectExistingPersistedArtifact(rootDir: string, plan: PersistedPackagePlan): ExistingPersistedArtifact | undefined {
  const manifestPath = join(persistedArtifactDir(rootDir, plan), PERSISTED_MANIFEST_FILE)
  if (!existsSync(manifestPath)) return undefined
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const dsh = isRecord(parsed) && isRecord(parsed.dsh) ? parsed.dsh : undefined
    const persisted = isRecord(dsh) && isRecord(dsh.persisted) ? dsh.persisted : undefined
    const rev = isRecord(persisted) && typeof persisted.rev === 'number' ? persisted.rev : null
    const originSession = isRecord(persisted) && typeof persisted.originSession === 'string' ? persisted.originSession : undefined
    return { rev, ...(originSession === undefined ? {} : { originSession }) }
  } catch {
    // A corrupt prior artifact degrades to an unknown replace, still confirmed by the human.
    return { rev: null }
  }
}

/**
 * Write one confirmed plan to disk: `<root>/<namespace>/<name>/` holding the
 * manifest and the verbatim Host source. The write refuses plans whose
 * rendered manifest fails {@link validatePersistedManifest} and paths escaping
 * the root, and best-effort tightens directory permissions to the owner.
 * @param rootDir - configured persistence root; created when missing.
 * @param plan - the confirmed plan to materialize.
 * @returns the absolute artifact directory and the written file names.
 * @throws when validation fails or the files cannot be written.
 */
export function writePersistedPackage(rootDir: string, plan: PersistedPackagePlan): { dir: string; files: string[] } {
  const rejection = validatePersistedManifest(buildManifestObject(plan))
  if (rejection !== null) throw new Error(`refusing to persist: ${rejection}`)
  const root = resolve(rootDir)
  const dir = persistedArtifactDir(root, plan)
  if (!dir.startsWith(root + sep)) {
    throw new Error('refusing to persist outside the configured plugins root')
  }
  mkdirSync(dir, { recursive: true })
  const files = [PERSISTED_MANIFEST_FILE, PERSISTED_ENTRY_FILE]
  writeFileSync(join(dir, PERSISTED_MANIFEST_FILE), `${JSON.stringify(buildManifestObject(plan), null, 2)}\n`, { mode: 0o600 })
  writeFileSync(join(dir, PERSISTED_ENTRY_FILE), plan.hostCode, { mode: 0o600 })
  /* v8 ignore next 5 -- POSIX tightening is platform-dependent and must never fail a confirmed write */
  try {
    chmodSync(dir, 0o700)
  } catch {
    // Non-fatal by design.
  }
  return { dir, files }
}

/** Absolute artifact directory for one plan under one root. */
function persistedArtifactDir(rootDir: string, plan: PersistedPackagePlan): string {
  return resolve(join(resolve(rootDir), plan.dirSuffix))
}
