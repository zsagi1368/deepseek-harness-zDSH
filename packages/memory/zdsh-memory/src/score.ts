/**
 * Keyword-overlap scoring and prompt-section rendering for memory injection.
 *
 * Deliberately embedding-free (token economy is the north star): text becomes a
 * token set — lowercased Latin/digit words plus CJK character bigrams — and an
 * entry's relevance is the size of its overlap with the current task's
 * keywords. Zero-overlap entries never inject.
 * @module @deepseek-ai/dsh-agent-memory/score
 */

import type { MemoryEntry, MemoryKind } from './types.ts'

/** Latin/digit words of length ≥ 2 (dots and separators ride along inside versions and file names). */
const LATIN_WORD = /[a-z0-9][a-z0-9._+-]*/giu

/** CJK ideograph runs; each run contributes single characters or adjacent bigrams. */
const CJK_RUN = /[\u4e00-\u9fff]+/gu

/**
 * Tokenize one text into the comparison vocabulary: lowercase Latin/digit
 * words (length ≥ 2) plus, per CJK run, that run's adjacent character
 * bigrams (a lone character stays itself).
 * @param text - the text to tokenize.
 * @returns the deduplicated token set.
 */
export function tokenize(text: string): Set<string> {
  const lowered = text.toLowerCase()
  const tokens = new Set<string>()
  for (const match of lowered.matchAll(LATIN_WORD)) {
    const word = match[0]
    if (word.length >= 2) tokens.add(word)
  }
  for (const match of lowered.matchAll(CJK_RUN)) {
    const run = match[0]
    if (run.length === 1) {
      tokens.add(run)
      continue
    }
    for (let index = 0; index < run.length - 1; index++) tokens.add(run.slice(index, index + 2))
  }
  return tokens
}

/** One selected entry with its keyword-overlap score. */
export interface ScoredEntry {
  readonly entry: MemoryEntry
  /** Number of shared tokens with the current task's keywords. */
  readonly score: number
}

/**
 * Score every entry against `keywords` and take the best K. Entries with zero
 * overlap are excluded; ties prefer newer entries, then smaller ids.
 * @param entries - candidate entries.
 * @param keywords - the current task's token set.
 * @param k - maximum selections; non-positive k selects nothing.
 * @returns the up-to-K best-scoring entries, most relevant first.
 */
export function selectTopK(entries: readonly MemoryEntry[], keywords: ReadonlySet<string>, k: number): ScoredEntry[] {
  if (!(k > 0)) return []
  const scored: ScoredEntry[] = []
  for (const entry of entries) {
    let score = 0
    for (const token of tokenize(entry.text)) {
      if (keywords.has(token)) score += 1
    }
    if (score > 0) scored.push({ entry, score })
  }
  scored.sort((a, b) =>
    b.score - a.score
    || b.entry.createdAt - a.entry.createdAt
    || (a.entry.id < b.entry.id ? -1 : a.entry.id > b.entry.id ? 1 : 0))
  return scored.slice(0, k)
}

/** Registered system-prompt section name (see `@deepseek-ai/dsh-system-prompt`). */
export const MEMORY_SECTION_NAME = 'agent:memory'

/** Section order: after the persona (0), before tool guidance (100–199). */
export const MEMORY_SECTION_ORDER = 20

/** User messages scanned backwards when deriving the current task's keywords. */
export const KEYWORD_SCAN_MESSAGES = 20

/** Stable model-facing label per entry kind. */
const KIND_LABEL: Record<MemoryKind, string> = {
  decision: 'decision',
  fact: 'conclusion',
  preference: 'preference',
}

/**
 * Render the injected section text. Empty input renders `''`, which the system
 * prompt drops — a session without relevant memories sees no memory section at
 * all. The rendered text rides the assembled system prompt, which the agent
 * loop logs verbatim in `request/header.system` (model-visible ⟺ logged).
 * @param scored - selected entries, most relevant first.
 * @returns the rendered section text, or `''` when `scored` is empty.
 */
export function renderMemorySection(scored: readonly ScoredEntry[]): string {
  if (scored.length === 0) return ''
  const lines = scored.map(({ entry }) => {
    const recalled = entry.hits > 1 ? ` (recalled x${String(entry.hits)})` : ''
    return `- [${KIND_LABEL[entry.kind]}] ${entry.text}${recalled}`
  })
  return `Memories from earlier sessions that look relevant to the current task:\n${lines.join('\n')}`
}
