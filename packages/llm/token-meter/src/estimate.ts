/**
 * Script-aware heuristic token pricing shared by the meter service and the
 * pure context-breakdown projection, so both surfaces price identical content
 * to identical numbers.
 *
 * @module @deepseek-ai/dsh-token-meter/estimate
 */

import type { ContentBlock, Message } from '@deepseek-ai/dsh-llm'
import type { EpochHeader } from '@deepseek-ai/dsh-session'

/** Fixed text-density estimate for Latin and other non-CJK scripts. */
const CHARS_PER_TOKEN = 4

/**
 * CJK text density (DSHV2-104). A flat 4-chars-per-token price undercounts
 * Chinese/Japanese/Korean content by roughly 3-4x: DeepSeek's tokenizer
 * averages about 0.6-1.0 characters per CJK token, so one Han/Kana/Hangul
 * character prices as ~1-1.7 tokens. 4/3 tokens per character (~0.75
 * chars/token) sits mid-band, biased toward the cautious end because this
 * heuristic exists to keep pressure estimates from running under reality.
 */
const CJK_TOKENS_NUMERATOR = 4
const CJK_TOKENS_DENOMINATOR = 3

/**
 * BMP ranges covering the CJK scripts and their punctuation/fullwidth forms:
 * CJK symbols and Kana, CJK ext-A, Unified Ideographs, Compatibility
 * Ideographs, Hangul syllables, and halfwidth/fullwidth forms.
 */
const CJK_PATTERN = /[\u3000-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7AF\uFF00-\uFFEF]/g

/** Count UTF-16 code units of `text` falling inside the CJK ranges. */
function countCjkUnits(text: string): number {
  // Reset between calls: the pattern carries the `g` flag.
  CJK_PATTERN.lastIndex = 0
  let count = 0
  for (let match = CJK_PATTERN.exec(text); match !== null; match = CJK_PATTERN.exec(text)) {
    count += match[0].length
  }
  return count
}

/**
 * Price free text under the script-aware density heuristic: CJK units at the
 * CJK density (see {@link CJK_TOKENS_NUMERATOR}), every other unit at
 * {@link CHARS_PER_TOKEN}.
 * @param text - text to price without mutation.
 * @returns heuristic tokens for the text alone (no structural overhead).
 */
export function estimateTextTokens(text: string): number {
  const cjkUnits = countCjkUnits(text)
  const otherUnits = text.length - cjkUnits
  return Math.ceil((cjkUnits * CJK_TOKENS_NUMERATOR) / CJK_TOKENS_DENOMINATOR)
    + Math.ceil(otherUnits / CHARS_PER_TOKEN)
}

/** Per-block structural overhead for JSON framing and type tags. */
const BLOCK_OVERHEAD = 4

/** Role-field framing overhead added to every priced message. */
export const ROLE_OVERHEAD = 4

/**
 * Price content blocks recursively under the script-aware density heuristic.
 * @param blocks - content blocks to price without mutation.
 * @returns heuristic tokens including per-block structural overhead.
 */
export function estimateContent(blocks: readonly ContentBlock[]): number {
  let tokens = 0
  for (const block of blocks) {
    switch (block.type) {
      case 'text':
      case 'reasoning':
        tokens += estimateTextTokens(block.text) + BLOCK_OVERHEAD
        break
      case 'tool-call':
        tokens += estimateTextTokens(block.name)
          + estimateTextTokens(block.arguments)
          + BLOCK_OVERHEAD
        break
      case 'tool-result':
        tokens += estimateContent(block.content) + BLOCK_OVERHEAD
        break
      default:
        // ContentBlockMap is merge-extensible; unknown blocks retain a
        // conservative structural JSON price under the fixed heuristic.
        tokens += BLOCK_OVERHEAD + estimateTextTokens(JSON.stringify(block))
    }
  }
  return tokens
}

/**
 * Heuristically price one model-visible message.
 * @param message - message to price without mutation.
 * @returns content and role-framing tokens under the fixed heuristic.
 */
export function estimateMessage(message: Message): number {
  return estimateContent(message.content) + ROLE_OVERHEAD
}

/**
 * Price the system-prompt part of a canonical request envelope.
 * @param header - canonical envelope, or undefined before any request.
 * @returns heuristic system-prompt tokens; 0 when absent.
 */
export function estimateSystemTokens(header: EpochHeader | undefined): number {
  if (header?.system === undefined) return 0
  return estimateTextTokens(header.system) + ROLE_OVERHEAD
}

/**
 * Price the tool-schema part of a canonical request envelope.
 * @param header - canonical envelope, or undefined before any request.
 * @returns heuristic tool-schema tokens; 0 when absent or empty.
 */
export function estimateToolsTokens(header: EpochHeader | undefined): number {
  if (header?.tools === undefined || header.tools.length === 0) return 0
  return estimateTextTokens(JSON.stringify(header.tools)) + BLOCK_OVERHEAD
}

/**
 * Price the complete non-surface request envelope.
 * @param header - canonical envelope, or undefined before any request.
 * @returns heuristic system plus tool tokens.
 */
export function estimateHeader(header: EpochHeader | undefined): number {
  return estimateSystemTokens(header) + estimateToolsTokens(header)
}
