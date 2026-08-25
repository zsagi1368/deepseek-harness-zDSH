/**
 * Message Rewriter — Converts image attachments to text descriptions
 */
import type { ImageAttachment, VisionDescription } from '../config/types.js'

/** A message whose image attachments were replaced with text markers. */
export interface RewrittenMessage {
  role: string
  content: string
  attachments?: never // Always empty after rewriting
}

/**
 * Rewrite a message containing images into pure text.
 * Images are replaced with structured text markers.
 * @param originalContent - the original message content.
 * @param images - the image attachments that were processed.
 * @param descriptions - the per-image vision descriptions to embed.
 * @returns the rewritten user message with markers appended.
 */
export function rewriteMessage(
  originalContent: string,
  images: ImageAttachment[],
  descriptions: VisionDescription[],
): RewrittenMessage {
  if (images.length === 0 || descriptions.length === 0) {
    return { role: 'user', content: originalContent }
  }

  // Build description markers
  const markers = descriptions
    .map((desc, i) => {
      const num = i + 1
      const summary = desc.summary || 'Image content'
      const ocr = desc.ocr ? `\nOCR: ${desc.ocr.substring(0, 500)}...` : ''
      return `[已识图${num}: ${summary}${ocr}]`
    })
    .join('\n\n')

  // Append descriptions to original message
  const newContent =
    images.length === 1
      ? `${originalContent}\n\n${markers}`
      : `${originalContent}\n\n已识图${images.length}张：\n${markers}`

  return {
    role: 'user',
    content: newContent,
  }
}

/**
 * Create text marker for a single image (for inline insertion)
 * @param description - the vision description to summarize.
 * @param index - the 1-based image number in the marker.
 * @returns the marker text embedding the summary.
 */
export function createTextMarker(description: VisionDescription, index: number): string {
  return `[已识图${index}: ${description.summary}]`
}

/**
 * Extract descriptions from rewritten content (for shadow history)
 * @param content - the rewritten content containing marker syntax.
 * @returns the descriptions parsed from the markers.
 */
export function extractDescriptions(content: string): VisionDescription[] {
  const descriptions: VisionDescription[] = []
  const regex = /\[已识图(\d+): ([^\]]+)\]/g
  let match: RegExpExecArray | null
  while (true) {
    match = regex.exec(content)
    if (match === null) break
    const index = parseInt(match[1] ?? '', 10)
    const summary = match[2] ?? ''
    descriptions.push({ summary, raw: { _index: index } })
  }

  return descriptions
}

/**
 * Sanitize content for DeepSeek (remove internal markers)
 * @param content - the content to clean.
 * @returns the content with internal vision markers removed.
 */
export function sanitizeForDeepSeek(content: string): string {
  // Remove __vision__ markers that are internal implementation details
  return content.replace(/\[__vision__:[^\]]+\]/g, '').trim()
}
