/**
 * Durable preinstall result ledger (DESIGN-intake-tech.md §1.4).
 *
 * Lives beside the approvals and installed-sources ledgers under the
 * governance persistence data directory (`<storageRoot>/data/
 * preinstall-results.json`) and copies their read/narrow/write discipline.
 * The ledger is the executor's memory of what each seed entry resolved to,
 * the plugin-center hub's discovery surface, and the carrier of the
 * `userUninstalled` tombstone that stops a removed preinstall from being
 * resurrected on the next boot.
 *
 * Callers commit through {@link savePreinstallResults} only while holding the
 * cross-process writer lock on this exact file (K-B1); the loader treats a
 * missing or corrupt file as an empty ledger so a first boot starts clean.
 * @module @deepseek-ai/dsh-plugin-governance-host/src/preinstall/results
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type {
  PreinstallEntryResult,
  PreinstallReport,
  PreinstallStatus,
} from '../types.ts'

/** On-disk v1 ledger shape. */
export interface PersistedPreinstallResults {
  version: 1
  ranAt: number | null
  entries: Record<string, PreinstallEntryResult>
}

/** The statuses the schema admits, mirroring {@link PreinstallStatus}. */
const STATUSES: readonly PreinstallStatus[] = ['installed', 'skipped', 'failed']

/** Empty ledger used when no durable record exists yet. */
export function emptyPreinstallResults(): PersistedPreinstallResults {
  return { version: 1, ranAt: null, entries: {} }
}

/** Narrow one parsed entry object to a {@link PreinstallEntryResult}. */
function readEntry(value: unknown): PreinstallEntryResult | null {
  if (typeof value !== 'object' || value === null) return null
  const record = value as Record<string, unknown>
  if (typeof record.status !== 'string' || !STATUSES.includes(record.status as PreinstallStatus)) return null
  if (typeof record.at !== 'number' || !Number.isFinite(record.at)) return null
  const reason = typeof record.reason === 'string' ? record.reason : null
  return {
    status: record.status as PreinstallStatus,
    ...(reason !== null ? { reason } : {}),
    at: record.at,
    ...(record.userUninstalled === true ? { userUninstalled: true } : {}),
  }
}

/**
 * Read the ledger from `path`; a missing or unreadable/corrupt file yields an
 * empty ledger (fail-open: losing the report never blocks boot, R-1.1.4).
 * Entries that are not a well-formed result row are dropped.
 */
export function loadPreinstallResults(path: string): PersistedPreinstallResults {
  if (!existsSync(path)) return emptyPreinstallResults()
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch {
    return emptyPreinstallResults()
  }
  if (typeof parsed !== 'object' || parsed === null) return emptyPreinstallResults()
  const record = parsed as Record<string, unknown>
  if (record.version !== 1 || typeof record.entries !== 'object' || record.entries === null) {
    return emptyPreinstallResults()
  }
  const entries: Record<string, PreinstallEntryResult> = {}
  for (const [id, value] of Object.entries(record.entries as Record<string, unknown>)) {
    const entry = readEntry(value)
    if (entry !== null) entries[id] = entry
  }
  const ranAt = typeof record.ranAt === 'number' && Number.isFinite(record.ranAt) ? record.ranAt : null
  return { version: 1, ranAt, entries }
}

/**
 * Commit the ledger to `path` (creating its parent directory). Throws so the
 * caller's lock-held cycle surfaces a write failure; no compensation is needed
 * because the in-memory model is rebuilt from disk on the next pass.
 */
export function savePreinstallResults(path: string, payload: PersistedPreinstallResults): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(payload, null, 2))
}

/** Project the durable ledger to the read-only client report. */
export function toReport(payload: PersistedPreinstallResults): PreinstallReport {
  return Object.freeze({
    ranAt: payload.ranAt,
    entries: Object.freeze({ ...payload.entries }),
  })
}
