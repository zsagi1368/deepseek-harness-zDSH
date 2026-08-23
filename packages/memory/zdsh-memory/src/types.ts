/**
 * Shared data shapes for the cross-session memory store. Types only — no
 * runtime code lives in this module.
 * @module @deepseek-ai/dsh-agent-memory/types
 */

/** What kind of session fact an entry records; the extraction rule that produced it. */
export type MemoryKind = 'decision' | 'fact' | 'preference'

/**
 * One stored memory entry: a bounded text captured from one session, plus the
 * provenance and recall counters the injection scorer reads.
 */
export interface MemoryEntry {
  /** Stable unique identity (`mem_` + random suffix). */
  readonly id: string
  /** Extraction rule family that produced this entry. */
  readonly kind: MemoryKind
  /** Captured text, whitespace-normalized and truncated to {@link MEMORY_TEXT_MAX_CHARS}. */
  readonly text: string
  /** Session the text was extracted from (`String(session.id)`). */
  readonly sessionId: string
  /** Unix epoch milliseconds of the source event. */
  readonly createdAt: number
  /** How many times re-extraction met the same normalized text (starts at 1). */
  readonly hits: number
}

/** A pre-persistence extraction product: everything {@link MemoryEntry} needs except identity and time. */
export interface MemoryCandidate {
  /** Rule family the candidate came from. */
  readonly kind: MemoryKind
  /** Truncated candidate text. */
  readonly text: string
}

/** On-disk daily shard format (`<root>/YYYY-MM-DD.json`). */
export interface MemoryShardFile {
  /** Format version; readers reject unknown versions instead of guessing. */
  readonly version: 1
  /** UTC day key the shard groups (`YYYY-MM-DD`, from `entry.createdAt`). */
  readonly date: string
  /** Entries whose `createdAt` falls on `date`, ascending by creation. */
  readonly entries: MemoryEntry[]
}
