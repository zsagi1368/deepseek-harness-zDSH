/**
 * Heuristic memory extraction — pure text rules, zero LLM calls.
 *
 * Three rule families read one message's plain text:
 * - decision: a user sentence carrying a decision cue, plus its successor sentence;
 * - preference: user corrective-feedback sentences (`不要` / `改成` / bare `别`);
 * - fact: the first prose sentence of an assistant final reply, annotated with
 *   fenced code-block language statistics when code is present.
 *
 * Every produced text is whitespace-normalized and truncated to
 * {@link MEMORY_TEXT_MAX_CHARS}, so stored entries stay bounded.
 * @module @deepseek-ai/dsh-agent-memory/extract
 */

import type { MemoryCandidate } from './types.ts'

/** Hard upper bound for one stored entry's text (ellipsis included). */
export const MEMORY_TEXT_MAX_CHARS = 200

/** Corrective sentences captured per user message, bounding noisy feedback bursts. */
export const MAX_PREFERENCES_PER_MESSAGE = 3

/** Sentence terminators that split extraction units. A Latin `.` is deliberately absent: it appears inside file names and versions. */
const SENTENCE_BREAK = /[。！？!?；;\n]+/u

/** Decision cues: a user statement committing a standing choice. */
export const DECISION_CUE = /(?:决定|就用|选定了|以后都)/u

/** Preference cues: corrective feedback about what to avoid or change. */
export const PREFERENCE_CUE = /(?:不要|不许|改成|别)/u

/**
 * Characters that turn a preceding `别` into an unrelated compound word
 * (特别, 分别, 级别, 区别, 判别, 差别, 性别, 作别 …); a `别` preceded by one of
 * these is not corrective feedback.
 */
const BARE_BIE_COMPOUND_PRECEDING = /[特区判级差分作性]/u

/** Normalize whitespace runs and truncate to {@link MEMORY_TEXT_MAX_CHARS}. */
export function truncateMemoryText(text: string, max: number = MEMORY_TEXT_MAX_CHARS): string {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`
}

/** Split one message into trimmed non-empty sentences. */
export function splitSentences(text: string): string[] {
  return text.split(SENTENCE_BREAK)
    .map(sentence => sentence.trim())
    .filter(sentence => sentence.length > 0)
}

/** Whether one sentence carries genuine corrective feedback (bare `别` must not be a compound word). */
function isPreferenceSentence(sentence: string): boolean {
  const match = PREFERENCE_CUE.exec(sentence)
  if (match === null) return false
  if (match[0] !== '别') return true
  const preceding = match.index > 0 ? sentence[match.index - 1] : undefined
  return preceding === undefined || !BARE_BIE_COMPOUND_PRECEDING.test(preceding)
}

/**
 * Extract decision and preference candidates from one human prompt.
 * @param text - the concatenated text blocks of one source-kind `user` message.
 * @returns zero or more truncated candidates; at most one decision, at most
 * {@link MAX_PREFERENCES_PER_MESSAGE} preferences.
 */
export function extractUserCandidates(text: string): MemoryCandidate[] {
  const sentences = splitSentences(text)
  const candidates: MemoryCandidate[] = []
  const decisionIndex = sentences.findIndex(sentence => DECISION_CUE.test(sentence))
  if (decisionIndex >= 0) {
    const parts = [sentences[decisionIndex] ?? '']
    const successor = sentences[decisionIndex + 1]
    if (successor !== undefined) parts.push(successor)
    candidates.push({ kind: 'decision', text: truncateMemoryText(parts.join('；')) })
  }
  let preferences = 0
  for (const sentence of sentences) {
    if (!isPreferenceSentence(sentence)) continue
    candidates.push({ kind: 'preference', text: truncateMemoryText(sentence) })
    preferences += 1
    if (preferences >= MAX_PREFERENCES_PER_MESSAGE) break
  }
  return candidates
}

/** Fenced code-block language statistics over one assistant reply. */
export interface CodeBlockStats {
  /** Number of opening fences encountered. */
  readonly blocks: number
  /** Most frequent info-string language (lexicographic tie-break), when any fence named one. */
  readonly dominantLanguage?: string
}

/**
 * Count fenced code blocks and their languages. Fence lines toggle open/closed
 * state; only opening fences count, so unterminated trailing fences still land.
 */
export function codeBlockStats(text: string): CodeBlockStats {
  const counts = new Map<string, number>()
  let blocks = 0
  let open = false
  for (const line of text.split(/\r?\n/u)) {
    const match = /^\s*`{3,}(.*)$/u.exec(line)
    if (match === null) continue
    const info = (match[1] ?? '').trim()
    if (!open) {
      open = true
      blocks += 1
      if (info.length > 0) counts.set(info, (counts.get(info) ?? 0) + 1)
    } else {
      open = false
    }
  }
  let best: { readonly language: string; readonly count: number } | undefined
  for (const [language, count] of counts) {
    if (best === undefined || count > best.count || (count === best.count && language < best.language)) {
      best = { language, count }
    }
  }
  return best === undefined ? { blocks } : { blocks, dominantLanguage: best.language }
}

/**
 * Extract the fact candidate from an assistant final reply: the first prose
 * sentence (fenced regions removed first), suffixed with fenced-code language
 * statistics when the reply carries code.
 * @param text - the assistant message's concatenated text blocks.
 * @returns one candidate, or `undefined` when neither prose nor code exists.
 */
export function extractAssistantCandidate(text: string): MemoryCandidate | undefined {
  const stats = codeBlockStats(text)
  const stripped = text.replace(/```[\s\S]*?(?:```|$)/gu, ' ')
  const [first] = splitSentences(stripped)
  if ((first === undefined || first.length === 0) && stats.blocks === 0) return undefined
  const suffix = stats.blocks > 0
    ? `（含${String(stats.blocks)}个${stats.dominantLanguage !== undefined ? `${stats.dominantLanguage} ` : ''}代码块）`
    : ''
  return { kind: 'fact', text: truncateMemoryText(`${first ?? ''}${suffix}`) }
}
