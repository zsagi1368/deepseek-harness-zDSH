/**
 * Pure model of the M5 file console (P01 §6-E FR-E1/E2): wire shapes,
 * client-side search/kind filtering, the virtual-scroll windowing math, and
 * display formatting. Zero DOM / zero React so every function unit-tests
 * directly (tests/client/console-model.test.ts).
 */

/** Mirror of the server LibraryResult wire shape (src/server/library.ts). */
export interface ConsoleEntry {
  readonly path: string
  readonly relativePath: string
  readonly name: string
  readonly sessionId: string
  readonly sizeBytes: number
  readonly uploadedAtMs: number
  readonly kind: ConsoleUsageKind
}

/** One upload session's files: a session-id key plus its latest entries and total size. */
export interface ConsoleSessionGroup {
  readonly sessionId: string
  readonly cwd?: string | undefined
  readonly entries: readonly ConsoleEntry[]
  readonly totalBytes: number
}

/** Wire shape of GET /api/filehub/library: sessions in recency order plus aggregate totals. */
export interface LibraryResponse {
  readonly sessions: readonly ConsoleSessionGroup[]
  readonly totalBytes: number
  readonly truncated: boolean
}

/** Per-kind usage tallies: file count and byte total. */
export interface UsageBucket {
  readonly files: number
  readonly bytes: number
}

/** Wire shape of GET /api/filehub/usage: totals plus per-kind and per-session breakdowns. */
export interface UsageResponse {
  readonly totalBytes: number
  readonly files: number
  readonly byKind: Readonly<Record<ConsoleUsageKind, UsageBucket>>
  readonly bySession: ReadonlyArray<{ sessionId: string; files: number; bytes: number }>
}

/** Wire shape of the cleanup report: what would be / was deleted (dry-run aware). */
export interface CleanupReportShape {
  readonly scope: 'expired' | 'session'
  readonly dryRun: boolean
  readonly wouldDelete: number
  readonly deleted: number
  readonly wouldFreeBytes: number
  readonly freedBytes: number
}

/** The five usage buckets served by GET /api/filehub/usage. */
export const CONSOLE_KINDS = ['image', 'document', 'text', 'binary', 'media'] as const
/** Usage-bucket key, one of {@link CONSOLE_KINDS}. */
export type ConsoleUsageKind = (typeof CONSOLE_KINDS)[number]

/** Kind-chip filter values: 'all' plus every usage bucket. */
export const KIND_FILTERS = ['all', ...CONSOLE_KINDS] as const
/** Kind chip value used by the console filter row. */
export type KindFilter = (typeof KIND_FILTERS)[number]

// ---------------------------------------------------------------------------
// Filtering (client-side; the server aggregates, the console narrows)
// ---------------------------------------------------------------------------

/**
 * Single-entry predicate: kind chip plus case-insensitive substring query.
 * @param entry - the entry to test.
 * @param q - the raw search query; trimmed and lower-cased before matching.
 * @param filter - the active kind chip; 'all' skips the kind check.
 * @returns true when the entry passes both the kind and the query test.
 */
export function matchesFilter(entry: ConsoleEntry, q: string, filter: KindFilter): boolean {
  if (filter !== 'all' && entry.kind !== filter) return false
  const needle = q.trim().toLowerCase()
  if (needle === '') return true
  return (
    entry.name.toLowerCase().includes(needle) ||
    entry.relativePath.toLowerCase().includes(needle)
  )
}

/**
 * Filter + sort (newest first) a flattened entry list.
 * @param entries - flattened entries in server recency order.
 * @param q - the search query passed to {@link matchesFilter}.
 * @param filter - the active kind chip.
 * @returns matching entries sorted newest first (ties broken by name).
 */
export function filterEntries(entries: readonly ConsoleEntry[], q: string, filter: KindFilter): ConsoleEntry[] {
  return entries
    .filter(entry => matchesFilter(entry, q, filter))
    .sort((a, b) => b.uploadedAtMs - a.uploadedAtMs || (a.name < b.name ? -1 : 1))
}

/**
 * Flatten an aggregate response preserving the server's session order (most
 * recently active first).
 * @param response - the wire response to flatten.
 * @returns every entry across all sessions, session order preserved.
 */
export function flattenLibrary(response: LibraryResponse): ConsoleEntry[] {
  const out: ConsoleEntry[] = []
  for (const group of response.sessions) out.push(...group.entries)
  return out
}

// ---------------------------------------------------------------------------
// Virtual scroll windowing (self-made, ~20 lines; no new dependencies)
// ---------------------------------------------------------------------------

/** One virtual-scroll window: the rendered row range plus spacer heights so the scrollbar reflects the full list. */
export interface WindowSlice {
  /** First rendered row index. */
  start: number
  /** One-past-the-last rendered row index. */
  end: number
  /** Spacer height above the slice (px). */
  padTop: number
  /** Spacer height below the slice (px). */
  padBottom: number
}

/**
 * Fixed-row-height windowing: given scrollTop and the viewport height, return
 * the visible range padded by `overscan` rows on both sides. Total row count
 * drives the spacers, so the scrollbar stays honest without rendering the
 * tail (thousands of rows stay cheap).
 * @param total - total row count in the list.
 * @param scrollTop - current scroll offset in px.
 * @param viewportHeight - visible viewport height in px.
 * @param rowHeight - fixed row height in px.
 * @param overscan - extra rows rendered above and below the visible range.
 * @returns the visible window: start/end indices plus spacer heights.
 */
export function computeWindow(
  total: number,
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  overscan = 6,
): WindowSlice {
  if (total <= 0 || rowHeight <= 0 || viewportHeight <= 0) {
    return { start: 0, end: 0, padTop: 0, padBottom: 0 }
  }
  // Clamp the first visible row to the list so a stale scrollTop (the list
  // shrank while the position persisted) still renders the TAIL, never an
  // empty window past the end.
  const firstVisible = Math.min(
    Math.floor(Math.max(0, scrollTop) / rowHeight),
    total - 1,
  )
  const start = Math.max(0, firstVisible - overscan)
  const visibleRows = Math.ceil(viewportHeight / rowHeight) + overscan * 2
  const end = Math.min(total, start + visibleRows)
  return {
    start,
    end,
    padTop: start * rowHeight,
    padBottom: Math.max(0, (total - end) * rowHeight),
  }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * Locale-aware short timestamp. Deterministic fields (no weekday names) so
 * tests can assert on shape instead of clock output.
 * @param ms - epoch millisecond timestamp.
 * @param lang - display locale: 'zh' uses dashes, 'en' uses slashes.
 * @returns 'YYYY-MM-DD HH:mm' (or 'YYYY/MM/DD HH:mm' for en); '?' for non-finite input.
 */
export function formatTimestamp(ms: number, lang: 'zh' | 'en'): string {
  if (!Number.isFinite(ms)) return '?'
  const date = new Date(ms)
  const two = (value: number): string => String(value).padStart(2, '0')
  const base = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())} ${two(date.getHours())}:${two(date.getMinutes())}`
  return lang === 'zh' ? base : base.replace('-', '/').replace('-', '/')
}

/** Rows fed to the virtualized list: session headers interleave with entries. */
export type ConsoleRow =
  | { readonly type: 'header'; readonly sessionId: string; readonly count: number; readonly bytes: number }
  | { readonly type: 'entry'; readonly entry: ConsoleEntry }

/**
 * Build the render-row list: grouped mode emits one header before each
 * session block; flat mode sorts everything newest-first with no headers.
 * @param entries - flattened entries in server recency order.
 * @param grouped - true for the grouped view with per-session headers.
 * @returns render rows ready for the virtualized list.
 */
export function buildRows(
  entries: readonly ConsoleEntry[],
  grouped: boolean,
): ConsoleRow[] {
  if (!grouped) {
    return entries.map(entry => ({ type: 'entry' as const, entry }))
  }
  const bySession = new Map<string, ConsoleEntry[]>()
  const order: string[] = []
  // Entries arrive pre-sorted newest-first, so group insertion order IS the
  // recency order — no extra sorting needed here.
  for (const entry of entries) {
    const bucket = bySession.get(entry.sessionId)
    if (!bucket) {
      bySession.set(entry.sessionId, [entry])
      order.push(entry.sessionId)
    } else {
      bucket.push(entry)
    }
  }
  const rows: ConsoleRow[] = []
  for (const sessionId of order) {
    const bucket = bySession.get(sessionId) ?? []
    rows.push({
      type: 'header',
      sessionId,
      count: bucket.length,
      bytes: bucket.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    })
    for (const entry of bucket) rows.push({ type: 'entry', entry })
  }
  return rows
}
