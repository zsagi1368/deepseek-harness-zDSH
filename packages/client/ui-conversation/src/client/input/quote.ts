/**
 * S-30 selection follow-up quote: pure formatting for carrying a transcript
 * selection into the composer as one markdown blockquote block. The composer
 * shell applies the composition through the ordinary draft machine, so the
 * quote lands as a single undo-able transaction and never mutates a claimed
 * command span.
 */

/**
 * Format selected prose as one quoted block (markdown blockquote lines).
 * @param text - verbatim selection text; blank text yields an empty block.
 * @returns the blockquote lines joined with newlines; no trailing newline.
 */
export function formatQuoteBlock(text: string): string {
  const body = text.trim()
  if (body === '') return ''
  return body.split(/\r?\n/u).map(line => `> ${line.trimEnd()}`).join('\n')
}

/**
 * Compose the next draft after appending a quote block: an empty draft is
 * replaced by the quote; otherwise the quote joins after a blank line so the
 * reader's existing words stay untouched above it.
 * @param draft - the current draft text.
 * @param quote - the formatted quote block (non-blank).
 * @returns the full next draft.
 */
export function composeQuotedDraft(draft: string, quote: string): string {
  return draft === '' ? quote : `${draft}\n\n${quote}`
}
