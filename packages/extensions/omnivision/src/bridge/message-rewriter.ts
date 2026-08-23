/**
 * Message Rewriter — Converts image attachments to text descriptions
 */
import type { ImageAttachment, VisionDescription } from '../config/types.js'

export interface RewrittenMessage {
  role: string
  content: string
  attachments?: never // Always empty after rewriting
}

/**
 * Rewrite a message containing images into pure text.
 * Images are replaced with structured text markers.
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
 */
export function createTextMarker(description: VisionDescription, index: number): string {
  return `[已识图${index}: ${description.summary}]`
}

/**
 * Extract descriptions from rewritten content (for shadow history)
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
 */
export function sanitizeForDeepSeek(content: string): string {
  // Remove __vision__ markers that are internal implementation details
  return content.replace(/\[__vision__:[^\]]+\]/g, '').trim()
}
