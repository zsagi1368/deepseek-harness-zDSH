/**
 * Content-addressed parse cache for the M3 reading domain (P01 §6-C FR-C7).
 *
 * Key: `sha256(bytes) + format + canonical(options)` — identical bytes parsed
 * with identical options always hit, regardless of the file name they were
 * uploaded under.
 *
 * Eviction is a dual-bound LRU: entries AND total cached bytes both cap
 * (defaults 64 entries / 256 MiB). Byte cost of one entry is the UTF-8 length
 * of its extracted text (the dominant allocation; overview objects are noise).
 *
 * Concurrency: same-key calls made while a parse is in flight share ONE
 * promise (in-flight dedupe) — N parallel read_document probes of the same
 * file run the waterfall exactly once.
 *
 * Versioning: each record carries a `version` field, reserved for future
 * invalidation (e.g. parser upgrades bumping PARSE_RECORD_VERSION to drop
 * stale extractions). No TTL by design — uploaded workspace files are
 * content-addressed and immutable while they exist.
 */

import { createHash } from 'node:crypto'

import type { ParsedDocument } from './types.js'

/** Bump when ParsedDocument's extraction semantics change materially. */
export const PARSE_RECORD_VERSION = 1

/** Cache bounds: entry and byte ceilings (both optional, both defaulted). */
export interface CacheOptions {
  /** Max cached documents. Default 64. */
  maxEntries?: number | undefined
  /** Max summed text bytes across all entries. Default 256 MiB. */
  maxBytes?: number | undefined
}

/** Default cache bounds: 64 entries / 256 MiB of extracted text. */
export const DEFAULT_CACHE_OPTIONS: Required<CacheOptions> = {
  maxEntries: 64,
  maxBytes: 256 * 1024 * 1024,
}

interface CacheRecord {
  version: number
  doc: ParsedDocument
  byteLength: number
}

/** Dual-bound LRU parse cache keyed by content hash, format, and options. */
export class ParseCache {
  private readonly maxEntries: number
  private readonly maxBytes: number
  /** Insertion-ordered map = LRU order (oldest first); refreshed on access. */
  private readonly records = new Map<string, CacheRecord>()
  private readonly inflight = new Map<string, Promise<ParsedDocument>>()
  private totalBytes = 0

  constructor(options: CacheOptions = {}) {
    this.maxEntries = Math.max(1, options.maxEntries ?? DEFAULT_CACHE_OPTIONS.maxEntries ?? 64)
    this.maxBytes = Math.max(1, options.maxBytes ?? DEFAULT_CACHE_OPTIONS.maxBytes ?? 256 * 1024 * 1024)
  }

  /**
   * The cache key for one parse request. `optionsKey` must already be a
   * canonical string of the parse-affecting options (sheet selector etc.).
   * @param content - the raw document bytes.
   * @param format - the detected document format.
   * @param optionsKey - canonicalized parse options component.
   * @returns the composite content-addressed key.
   */
  static keyOf(content: Uint8Array, format: string, optionsKey: string): string {
    const digest = createHash('sha256').update(content).digest('hex')
    return `${digest}:${format}:${optionsKey}`
  }

  /** Current entry count (exposed for tests/observability). */
  get size(): number {
    return this.records.size
  }

  /**
   * Peek a cached document without refreshing LRU order or parsing.
   * @param key - the cache key to look up.
   * @returns the cached document, or undefined on a miss.
   */
  peek(key: string): ParsedDocument | undefined {
    return this.records.get(key)?.doc
  }

  /**
   * Get-or-compute with in-flight dedupe: concurrent callers with the same key
   * share one promise; a failed compute evicts the tombstone so a retry can
   * try again.
   * @param key - the composite cache key.
   * @param compute - the parse to run on a miss.
   * @returns the parsed document (cached, in-flight, or freshly computed).
   */
  wrap(key: string, compute: () => Promise<ParsedDocument>): Promise<ParsedDocument> {
    const hit = this.records.get(key)
    if (hit !== undefined) {
      // Refresh LRU position.
      this.records.delete(key)
      this.records.set(key, hit)
      return Promise.resolve(hit.doc)
    }
    const pending = this.inflight.get(key)
    if (pending !== undefined) return pending

    const promise = compute().then(
      (doc) => {
        this.inflight.delete(key)
        this.store(key, doc)
        return doc
      },
      (error: unknown) => {
        this.inflight.delete(key)
        throw error
      },
    )
    this.inflight.set(key, promise)
    return promise
  }

  private store(key: string, doc: ParsedDocument): void {
    const byteLength = Buffer.byteLength(doc.text, 'utf8')
    if (byteLength > this.maxBytes) return // single document exceeds the whole budget — don't cache
    // Drop any superseded record for this key before re-inserting at the end.
    this.evictKey(key)
    this.records.set(key, { version: PARSE_RECORD_VERSION, doc, byteLength })
    this.totalBytes += byteLength
    while (this.records.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldestKey = this.records.keys().next().value
      if (oldestKey === undefined) break
      this.evictKey(oldestKey)
    }
  }

  private evictKey(key: string): void {
    const existing = this.records.get(key)
    if (existing === undefined) return
    this.totalBytes -= existing.byteLength
    this.records.delete(key)
  }
}
