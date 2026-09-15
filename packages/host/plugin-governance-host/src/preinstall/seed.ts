/**
 * Seed manifest reader for the factory preinstall pass.
 *
 * The seed file (`zdsh-factory/seed.json`, schema frozen in
 * DESIGN-intake-tech.md §1.1) is an untrusted, declarative document. This
 * module consumes it through an explicit **field whitelist** (reviewer
 * 建议②): only the fields the executor actually acts on are read; every
 * other key — the manifest-level `$comment` / `entryFields` prose and any
 * future explanatory fields — is ignored wholesale rather than validated.
 *
 * The whitelist is a deny-by-default surface: an entry is kept only when its
 * `id` and `source` are present and well-formed. A seed whose `entries` is
 * empty (the current skeleton state) parses to a zero-length list, so the
 * preinstall pass is a pure no-op passthrough (TC-B1-1.2b 验收直通用例).
 * @module @deepseek-ai/dsh-plugin-governance-host/src/preinstall/seed
 */

/** One whitelisted seed entry as the executor consumes it (§1.1 schema). */
export interface SeedEntry {
  /** Canonical governance id (`namespace/name`, same key space as the registry). */
  readonly id: string
  /** npm package name the source resolves against (parse anchor). */
  readonly package: string
  /** Exact semver the entry pins (V25 exact-version-only policy). */
  readonly version: string
  /** 40-hex git commit the supply chain pins (local: integrity carrier). */
  readonly pin: string
  /** Two-state source: `local:<in-repo path>` or `npm:<name>[@<ver>]`. */
  readonly source: string
  /** sha512 for `npm:` sources (V25 tarball check); `null` for `local:` (§1.1-D1). */
  readonly integrity: string | null
  /** Whether the plugin activates at boot; `false` = installed-but-disabled. */
  readonly enabledAtBoot: boolean
  /** Family tag (webstack / -bridge / -verticals batch grouping). */
  readonly family: string
  /** Failure posture; `fail-open` is the only legal value this campaign (R-1.1.4). */
  readonly failPolicy: string
}

/** Parsed seed manifest: the version gate plus the whitelisted entries. */
export interface SeedManifest {
  /** Schema version, always the accepted constant for a valid seed. */
  readonly version: number
  /** Entries the whitelist accepted, in file order. Empty ⇒ zero-action pass. */
  readonly entries: readonly SeedEntry[]
}

/** The only seed schema version this reader understands. */
export const SEED_SCHEMA_VERSION = 1

/** Narrow one parsed JSON value to a plain object view. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Trimmed non-empty string, else `null`. */
function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/** Read one whitelisted entry, or `null` when it is missing a load-bearing field. */
function parseEntry(value: unknown): SeedEntry | null {
  if (!isRecord(value)) return null
  // id + source are load-bearing: without them the entry is inert and skipped.
  const id = str(value.id)
  const source = str(value.source)
  if (id === null || source === null) return null
  // `local:` must name a path, `npm:` a package spec; anything else is dropped.
  if (!(source.startsWith('local:') || source.startsWith('npm:'))) return null
  return {
    id,
    package: str(value.package) ?? id,
    version: str(value.version) ?? '0.0.0',
    pin: str(value.pin) ?? '',
    source,
    integrity: str(value.integrity),
    // Absent or non-boolean reads as disabled: boot-activation is opt-in.
    enabledAtBoot: value.enabledAtBoot === true,
    family: str(value.family) ?? '',
    failPolicy: str(value.failPolicy) ?? 'fail-open',
  }
}

/**
 * Parse a raw seed document into the whitelisted view. A missing, non-object,
 * or wrong-version document yields an empty entry list (the caller treats a
 * file that is not present as a whole-pass no-op; a malformed or versioned-
 * differently file is likewise inert rather than fatal — fail-open, R-1.1.4).
 * @param raw - the parsed JSON value read from the seed file, or `undefined`.
 * @returns the accepted schema version and the whitelist-accepted entries.
 */
export function parseSeedManifest(raw: unknown): SeedManifest {
  if (!isRecord(raw)) return { version: SEED_SCHEMA_VERSION, entries: [] }
  if (raw.version !== SEED_SCHEMA_VERSION) return { version: SEED_SCHEMA_VERSION, entries: [] }
  const list = Array.isArray(raw.entries) ? raw.entries : []
  const entries: SeedEntry[] = []
  for (const value of list) {
    const entry = parseEntry(value)
    if (entry !== null) entries.push(entry)
  }
  return { version: SEED_SCHEMA_VERSION, entries }
}
