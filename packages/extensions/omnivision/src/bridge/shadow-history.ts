/**
 * Shadow History — Maintains UI consistency while protecting KV cache
 */
import type { ImageAttachment } from '../config/types.js'

/** Per-image split view: kept for the UI, replaced by text for the model. */
export interface ShadowReplacement {
  surfaceOp: { op: 'keep'; eventId: string }
  modelOp: { op: 'replace'; eventId: string; replacement: string }
}

/**
 * Create one shadow replacement per image.
 * Each image gets its own eventId so UI and model views are properly separated.
 * @param originalEventId - the event id of the originating message.
 * @param images - the image attachments to split out.
 * @param descriptions - per-image replacement text, aligned by index.
 * @returns one shadow replacement per image, with unique child event ids.
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

/**
 * Whether a message carries image attachments.
 * @param message - the message to inspect.
 * @returns true when the attachments array is non-empty.
 */
export function hasImageAttachments(message: { attachments?: unknown[] }): boolean {
  return Array.isArray(message.attachments) && message.attachments.length > 0
}

/**
 * The image attachments of a message, or an empty list.
 * @param message - the message to inspect.
 * @returns the attachment array when present, else [].
 */
export function extractImageAttachments(message: {
  attachments?: ImageAttachment[]
}): ImageAttachment[] {
  return Array.isArray(message.attachments) ? message.attachments : []
}

/**
 * Strip attachments from a message, keeping only role and content.
 * @param message - the message to strip.
 * @returns the message with attachments removed.
 */
export function removeImageAttachments(message: {
  attachments?: unknown[]
  content: string
  role: string
}): { content: string; role: string } {
  return { role: message.role, content: message.content }
}
