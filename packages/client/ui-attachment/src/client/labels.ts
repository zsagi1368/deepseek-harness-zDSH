import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { AttachmentRailLabels } from '../AttachmentRail.tsx'
import type { DropOverlayLabels } from '../DropOverlay.tsx'
import type { ImageLightboxLabels } from '../ImageLightbox.tsx'
import type { MessageImageLabels } from '../MessageImage.tsx'
/**
 * Resolve original-image lightbox strings from the conversation namespace.
 * @param t - conversation namespace translator.
 * @returns translated lightbox labels.
 */
export function lightboxLabels(t: TranslateNS<'conversation'>): ImageLightboxLabels {
  return { dialog: t('image.preview'), close: t('image.closePreview') }
}

/**
 * Resolve historical message-image strings from the conversation namespace.
 * @param t - conversation namespace translator.
 * @returns translated message-image labels.
 */
export function messageImageLabels(t: TranslateNS<'conversation'>): MessageImageLabels {
  return {
    image: t('image.label'),
    open: t('image.openOriginal'),
    openNamed: label => t('image.openOriginalLabel', { label }),
    loading: t('image.loading'),
    loadFailed: t('image.loadFailed'),
    lightbox: lightboxLabels(t),
  }
}

/**
 * Resolve the document-level drop invitation and its optional limits line.
 * When the plugin's own translator is available the invitation speaks of
 * files (text drafts are accepted beside images); otherwise it keeps the
 * conversation namespace's image wording.
 * @param t - conversation namespace translator.
 * @param accepting - whether the composer can accept dropped files.
 * @param limits - optional translated count and size values.
 * @param tAttachment - this plugin's bound `attachment` translator, when composed.
 * @returns translated drop-overlay labels.
 */
export function dropOverlayLabels(
  t: TranslateNS<'conversation'>,
  accepting: boolean,
  limits?: { readonly count: number; readonly size: string },
  tAttachment?: TranslateNS<'attachment'>,
): DropOverlayLabels {
  if (!accepting) return { title: tAttachment === undefined ? t('image.dropBlocked') : tAttachment('text.dropBlocked') }
  return {
    title: tAttachment === undefined ? t('image.dropTitle') : tAttachment('text.dropTitle'),
    desc: limits === undefined ? undefined : t('image.dropDesc', limits),
  }
}

/**
 * Resolve draft-image rail strings from the conversation namespace.
 * @param t - conversation namespace translator.
 * @returns translated attachment-rail labels.
 */
export function attachmentRailLabels(t: TranslateNS<'conversation'>): AttachmentRailLabels {
  return {
    group: t('image.pending'),
    open: t('image.openOriginal'),
    scrollLeft: t('image.scrollLeft'),
    scrollRight: t('image.scrollRight'),
  }
}
