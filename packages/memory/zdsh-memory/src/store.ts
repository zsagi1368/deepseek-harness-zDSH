/**
 * The daily-shard memory store.
 *
 * Entries live in `<root>/YYYY-MM-DD.json` (UTC day of `createdAt`), one JSON
 * {@link MemoryShardFile} per day. Every write goes through
 * `writeFileAtomic` (exclusive-create temp + rename), so readers observe old or
 * new complete content; in-process mutations serialize through one promise
 * chain. Capacity is global across shards: appending past the cap evicts the
 * oldest entries FIFO, deleting shard files that empty out. A repeated
 * extraction (same kind + normalized text) increments the existing entry's
 * `hits` instead of duplicating it.
 * @module @deepseek-ai/dsh-agent-memory/store
 */

import { randomUUID } from 'node:crypto'
import { readFile, readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type { MemoryCandidate, MemoryEntry, MemoryKind, MemoryShardFile } from './types.ts'

/** Global entry cap across all daily shards. */
export const DEFAULT_MEMORY_CAPACITY = 500

/** Shard file names this store owns (strict UTC-day keys). */
const SHARD_NAME = /^\d{4}-\d{2}-\d{2}\.json$/u

/** Valid memory kinds, guarding deserialization. */
const KINDS: readonly MemoryKind[] = ['decision', 'fact', 'preference']

/**
 * UTC day key (`YYYY-MM-DD`) of one epoch timestamp — the shard a file groups by.
 * @param timestamp - the epoch-millisecond timestamp to key.
 * @returns the UTC `YYYY-MM-DD` day key.
 */
export function dateKeyOf(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

/** Deterministic dedupe key: kind plus case-folded whitespace-normalized text. */
function dedupeKey(entry: Pick<MemoryEntry, 'kind' | 'text'>): string {
  return `${entry.kind}\u0000${entry.text.toLowerCase().replace(/\s+/gu, ' ').trim()}`
}

/** Oldest-first total order (creation time, then identity) used for FIFO eviction and listing. */
function olderThan(a: MemoryEntry, b: MemoryEntry): number {
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/** Parse one shard file's text; malformed content degrades to zero entries instead of failing loads. */
function parseShard(raw: string, expectedDate: string): MemoryEntry[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return []
  }
  if (parsed === null || typeof parsed !== 'object') return []
  const candidate = parsed as { version?: unknown; date?: unknown; entries?: unknown }
  if (candidate.version !== 1 || candidate.date !== expectedDate) return []
  if (!Array.isArray(candidate.entries)) return []
  const entries: MemoryEntry[] = []
  for (const item of candidate.entries) {
    if (item === null || typeof item !== 'object') continue
    const entry = item as Record<string, unknown>
    if (typeof entry.id !== 'string' || entry.id.length === 0) continue
    if (typeof entry.kind !== 'string' || !KINDS.includes(entry.kind as MemoryKind)) continue
    if (typeof entry.text !== 'string' || entry.text.length === 0) continue
    if (typeof entry.sessionId !== 'string') continue
    if (typeof entry.createdAt !== 'number' || !Number.isFinite(entry.createdAt)) continue
    if (typeof entry.hits !== 'number' || !Number.isSafeInteger(entry.hits) || entry.hits < 1) continue
    entries.push({
      id: entry.id,
      kind: entry.kind as MemoryKind,
      text: entry.text,
      sessionId: entry.sessionId,
      createdAt: entry.createdAt,
      hits: entry.hits,
    })
  }
  return entries
}

/**
 * Split an ordered list into kept survivors and FIFO-evicted heads.
 * @param entries - the entries to trim.
 * @param capacity - the maximum number of entries to keep.
 * @returns the kept survivors and the oldest entries evicted past capacity.
 */
export function evictToCapacity(entries: readonly MemoryEntry[], capacity: number): {
  kept: MemoryEntry[]
  evicted: MemoryEntry[]
} {
  if (entries.length <= capacity) return { kept: [...entries], evicted: [] }
  const sorted = [...entries].sort(olderThan)
  const head = sorted.length - capacity
  return { kept: sorted.slice(head), evicted: sorted.slice(0, head) }
}

/** Store construction options. */
export interface MemoryStoreOptions {
  /** Global capacity across shards (default {@link DEFAULT_MEMORY_CAPACITY}). */
  capacity?: number | undefined
}

/**
 * File-backed memory store over daily shards. All mutations serialize through
 * an internal promise chain; `list`/`cachedEntries` expose the loaded snapshot.
 */
export class MemoryStore {
  private readonly capacity: number
  private entries: MemoryEntry[] = []
  private loaded = false
  private queue: Promise<unknown> = Promise.resolve()
  /** Last serialized content per written shard date; presence marks a file on disk. */
  private readonly writtenDates = new Map<string, string>()

  constructor(private readonly root: string, options: MemoryStoreOptions = {}) {
    this.capacity = options.capacity ?? DEFAULT_MEMORY_CAPACITY
  }

  /** Directory the daily shards live under. */
  get storageRoot(): string {
    return this.root
  }

  private shardPath(date: string): string {
    return join(this.root, `${date}.json`)
  }

  /** Serialize one mutation behind the in-process queue tail. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation)
    this.queue = next.catch(() => {})
    return next
  }

  /** Read every shard from disk, oldest first; unknown files are ignored. */
  private async readAll(): Promise<void> {
    const names = await readdir(this.root).catch(() => [] as string[])
    const collected: MemoryEntry[] = []
    for (const name of names.filter(name => SHARD_NAME.test(name)).sort()) {
      const date = name.slice(0, 'YYYY-MM-DD'.length)
      const raw = await readFile(this.shardPath(date), 'utf8').catch(() => '')
      collected.push(...parseShard(raw, date))
      // Presence marks the file on disk so a later emptied group deletes it.
      this.writtenDates.set(date, '')
    }
    this.entries = collected.sort(olderThan)
    this.loaded = true
  }

  /**
   * Rewrite every touched day's shard (or delete it when its group emptied),
   * atomically replacing bytes at mode 0o600 inside a 0o700 directory.
   */
  private async persistTouched(dates: Iterable<string>): Promise<void> {
    for (const date of dates) {
      const group = this.entries.filter(entry => dateKeyOf(entry.createdAt) === date)
      if (group.length === 0) {
        if (this.writtenDates.delete(date)) await rm(this.shardPath(date), { force: true })
        continue
      }
      const shard: MemoryShardFile = { version: 1, date, entries: group }
      const raw = JSON.stringify(shard)
      await writeFileAtomic(this.shardPath(date), raw, { mode: 0o600, dirMode: 0o700 })
      this.writtenDates.set(date, raw)
    }
  }

  /**
   * Record one extracted candidate: dedupe to a `hits` increment, otherwise
   * append and evict past capacity. Returns the stored (or updated) entry.
   * @param candidate - the extracted memory candidate to record.
   * @param sessionId - the session the candidate came from.
   * @param now - the creation timestamp to stamp a new entry with; defaults to
   * the current time.
   * @returns the stored or updated memory entry.
   */
  record(candidate: MemoryCandidate, sessionId: string, now: number = Date.now()): Promise<MemoryEntry> {
    return this.enqueue(async () => {
      if (!this.loaded) await this.readAll()
      const key = dedupeKey(candidate)
      const existing = this.entries.find(entry => dedupeKey(entry) === key)
      if (existing !== undefined) {
        const updated: MemoryEntry = { ...existing, hits: existing.hits + 1 }
        this.entries = this.entries.map(entry => entry === existing ? updated : entry)
        await this.persistTouched([dateKeyOf(updated.createdAt)])
        return updated
      }
      const entry: MemoryEntry = {
        id: `mem_${randomUUID()}`,
        kind: candidate.kind,
        text: candidate.text,
        sessionId,
        createdAt: now,
        hits: 1,
      }
      const { kept, evicted } = evictToCapacity([...this.entries, entry], this.capacity)
      this.entries = kept
      const touched = new Set<string>([dateKeyOf(entry.createdAt), ...evicted.map(evictedEntry => dateKeyOf(evictedEntry.createdAt))])
      await this.persistTouched(touched)
      return entry
    })
  }

  /**
   * Remove one entry by id wherever its shard lives.
   * @param id - the entry id to remove.
   * @returns whether an entry was removed.
   */
  forget(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      if (!this.loaded) await this.readAll()
      const victim = this.entries.find(entry => entry.id === id)
      if (victim === undefined) return false
      this.entries = this.entries.filter(entry => entry.id !== id)
      await this.persistTouched([dateKeyOf(victim.createdAt)])
      return true
    })
  }

  /** Entries ordered oldest-first (the authoritative view order). */
  private sorted(): MemoryEntry[] {
    return [...this.entries].sort(olderThan)
  }

  /**
   * Snapshot of every stored entry, oldest first.
   * @returns the stored entries, oldest first.
   */
  list(): Promise<MemoryEntry[]> {
    return this.enqueue(async () => {
      if (!this.loaded) await this.readAll()
      return this.sorted()
    })
  }

  /**
   * Synchronous view of the currently loaded cache for prompt-time scorers.
   * Empty before the first load completes.
   * @returns the cached entries, oldest first.
   */
  cachedEntries(): readonly MemoryEntry[] {
    return this.sorted()
  }

  /** Load eagerly (the plugin calls this once at activation); safe to call repeatedly. */
  load(): Promise<void> {
    return this.enqueue(async () => {
      if (!this.loaded) await this.readAll()
    })
  }

  /** Await quiescence of pending mutations (disposal seam). */
  async drain(): Promise<void> {
    await this.queue.catch(() => {})
  }
}
