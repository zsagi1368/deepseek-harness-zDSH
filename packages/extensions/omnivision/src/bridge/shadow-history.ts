/**
 * Shadow History — Maintains UI consistency while protecting KV cache
 */
import type { ImageAttachment } from '../config/types.js'

export interface ShadowReplacement {
  surfaceOp: { op: 'keep'; eventId: string }
  modelOp: { op: 'replace'; eventId: string; replacement: string }
}

/**
 * Create one shadow replacement per image.
 * Each image gets its own eventId so UI and model views are properly separated.
 */
export function createShadowReplacements(
  originalEventId: string,
  images: ImageAttachment[],
  descriptions: string[],
): ShadowReplacement[] {
  if (images.length === 0) return []
  // Each image gets a unique replacement event
  return images.map((_, i) => ({
    surfaceOp: { op: 'keep' as const, eventId: `${originalEventId}-img-${i}` },
    modelOp: { op: 'replace' as const, eventId: `${originalEventId}-img-${i}`, replacement: descriptions[i] ?? '' },
  }))
}

export function hasImageAttachments(message: { attachments?: unknown[] }): boolean {
  return Array.isArray(message.attachments) && message.attachments.length > 0
}

export function extractImageAttachments(message: {
  attachments?: ImageAttachment[]
}): ImageAttachment[] {
  return Array.isArray(message.attachments) ? message.attachments : []
}

export function removeImageAttachments(message: {
  attachments?: unknown[]
  content: string
  role: string
}): { content: string; role: string } {
  return { role: message.role, content: message.content }
}
