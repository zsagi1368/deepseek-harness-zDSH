import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  ComposerAttachment, ComposerAttachmentsProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { AttachmentRail } from '../AttachmentRail.tsx'
import type { AttachmentRailItem } from '../AttachmentRail.tsx'
import { DropOverlay } from '../DropOverlay.tsx'
import { ImageLightbox } from '../ImageLightbox.tsx'
import { attachmentRailLabels, dropOverlayLabels, lightboxLabels } from './labels.ts'
import {
  appendDraftSegment, decodeDraftText, DRAFT_TEXT_MAX_BYTES, draftTextSegment, isDraftTextFile,
  removeDraftSegment,
} from './text-attachments.ts'
import css from './ComposerAttachments.module.css'

/** Injected copy seat: this plugin's bound translator over the `attachment`
 * namespace; absent compositions fall back to the conversation keys. */
export interface ComposerAttachmentsInjected {
  /** Live text-draft translator (reads the active locale at call time). */
  tAttachment?: TranslateNS<'attachment'>
}

/** Full props of the entry: the conversation-declared slot contract plus the
 * injected copy seat supplied by this plugin's registration. */
export type WiredComposerAttachmentsProps =
  ComposerAttachmentsProps & InjectFace<ComposerAttachmentsInjected>

/** One accepted text draft: the card identity and the exact segment it owns. */
interface DraftTextCard {
  /** Stable identity for React keys and removal. */
  id: string
  /** Cleaned display name shown on the card. */
  name: string
  /** Exact `[name]\n<content>` block inserted into the draft. */
  segment: string
}

/** Rail item retaining its browser-owned attachment for callbacks. */
interface ComposerRailItem extends AttachmentRailItem {
  /** Present on image items only; text cards own no browser object. */
  attachment?: ComposerAttachment | undefined
}

/**
 * Clean a browser-reported file name into the card and segment heading.
 * @param value - raw name as reported by the drop.
 * @returns the separator-free leaf name, capped like stored references.
 */
function cleanName(value: string): string {
  const leaf = value.slice(Math.max(value.lastIndexOf('/'), value.lastIndexOf('\\')) + 1)
  return leaf.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 255)
}

/** Draft-image rail, document drop target, text-file draft intake, and
 * original-image preview slot entry.
 *
 * Image files keep their existing path (`onAddImages`). Text candidates that
 * pass the whitelist, byte cap, and UTF-8 probe are appended to the composer
 * draft as `[name]`-headed segments through the input machine's public write
 * path, so sending carries them inside the message's text block; each card
 * tracks its exact span and takes it back on removal. A lost drag (drop
 * outside the page, Esc cancel, iframe crossings) is reaped by the
 * pointer/blur watchdog that keeps the invitation overlay honest.
 */
export function ComposerAttachments({
  attachments, canAcceptDrop, onAddImages, onRemoveImage, dropLimits, t,
  useInput, inputActions, tAttachment,
}: WiredComposerAttachmentsProps) {
  const [preview, setPreview] = useState<ComposerAttachment | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [textCards, setTextCards] = useState<DraftTextCard[]>([])
  const dragDepth = useRef(0)
  const closePreview = useCallback(() => { setPreview(null) }, [])
  // Async intake reads bytes after the drop event returned, so appends must
  // target the machine's CURRENT draft, not the snapshot at drop time.
  const input = useInput(state => state)
  const latestDraftRef = useRef(input?.draft ?? '')
  latestDraftRef.current = input?.draft ?? ''

  useEffect(() => {
    if (preview !== null && !attachments.some(attachment => attachment.id === preview.id)) setPreview(null)
  }, [attachments, preview])

  const reset = useCallback((): void => {
    dragDepth.current = 0
    setDragActive(false)
  }, [])

  const intakeDraftTexts = useCallback((files: readonly File[]): void => {
    if (inputActions === undefined) return
    void (async (): Promise<void> => {
      const accepted: DraftTextCard[] = []
      for (const file of files) {
        if (file.size === 0 || file.size > DRAFT_TEXT_MAX_BYTES) continue
        const name = cleanName(file.name)
        if (name === '') continue
        try {
          const text = decodeDraftText(new Uint8Array(await file.arrayBuffer()))
          // Re-read the mirrored draft per file so back-to-back drops stack
          // instead of overwriting each other's append.
          const segment = draftTextSegment(name, text)
          const next = appendDraftSegment(latestDraftRef.current, segment)
          inputActions.setDraft(next)
          latestDraftRef.current = next
          accepted.push({ id: crypto.randomUUID(), name, segment })
        } catch {
          // Undecodable or control-laden content is not a text draft; skip.
        }
      }
      if (accepted.length > 0) setTextCards(cards => [...cards, ...accepted])
    })()
  }, [inputActions])

  const removeTextCard = useCallback((id: string): void => {
    const card = textCards.find(candidate => candidate.id === id)
    setTextCards(cards => cards.filter(candidate => candidate.id !== id))
    if (card === undefined || inputActions === undefined) return
    const result = removeDraftSegment(latestDraftRef.current, card.segment)
    if (result.removed) {
      inputActions.setDraft(result.draft)
      latestDraftRef.current = result.draft
    }
  }, [textCards, inputActions])

  useEffect(() => {
    const fileTransfer = (event: globalThis.DragEvent): DataTransfer | null => {
      const dataTransfer = event.dataTransfer
      if (dataTransfer === null || !dataTransfer.types.includes('Files')) return null
      return dataTransfer
    }
    const onDragEnter = (event: globalThis.DragEvent): void => {
      if (fileTransfer(event) === null) return
      event.preventDefault()
      dragDepth.current += 1
      setDragActive(true)
    }
    const onDragOver = (event: globalThis.DragEvent): void => {
      const dataTransfer = fileTransfer(event)
      if (dataTransfer === null) return
      event.preventDefault()
      dataTransfer.dropEffect = canAcceptDrop ? 'copy' : 'none'
    }
    const onDragLeave = (event: globalThis.DragEvent): void => {
      if (fileTransfer(event) === null) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragActive(false)
      const leftViewport = event.clientX <= 0 || event.clientY <= 0
        || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight
      if ((event.target === document.documentElement || event.target === document.body) && leftViewport) reset()
    }
    const onDrop = (event: globalThis.DragEvent): void => {
      const dataTransfer = fileTransfer(event)
      if (dataTransfer === null) return
      event.preventDefault()
      reset()
      if (!canAcceptDrop) return
      const files = [...dataTransfer.files]
      const images = files.filter(file => !isDraftTextFile(file))
      const texts = files.filter(isDraftTextFile)
      if (images.length > 0) onAddImages(images)
      if (texts.length > 0) intakeDraftTexts(texts)
    }
    document.addEventListener('dragenter', onDragEnter)
    document.addEventListener('dragover', onDragOver)
    document.addEventListener('dragleave', onDragLeave)
    document.addEventListener('drop', onDrop)
    window.addEventListener('dragend', reset)
    return () => {
      document.removeEventListener('dragenter', onDragEnter)
      document.removeEventListener('dragover', onDragOver)
      document.removeEventListener('dragleave', onDragLeave)
      document.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', reset)
    }
  }, [canAcceptDrop, onAddImages, intakeDraftTexts, reset])

  // Lost-drag watchdog. OS-initiated file drags have no in-page source, so
  // `dragend` never fires for them, and engines suppress pointer events while
  // a drag lives; when such a drag ends without landing in the page (dropped
  // on another app, Esc-cancelled, crossing an iframe boundary), no paired
  // `dragleave` arrives and the overlay used to strand itself on screen. The
  // first ordinary pointer press/move or window blur after that proves the
  // drag is long gone — none of these fire mid-drag.
  useEffect(() => {
    if (!dragActive) return
    window.addEventListener('pointermove', reset)
    window.addEventListener('mousedown', reset)
    window.addEventListener('blur', reset)
    const onVisibilityChange = (): void => {
      if (document.hidden) reset()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('pointermove', reset)
      window.removeEventListener('mousedown', reset)
      window.removeEventListener('blur', reset)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [dragActive, reset])

  const railItems = useMemo<ComposerRailItem[]>(() => [
    ...attachments.map((attachment): ComposerRailItem => ({
      id: attachment.id,
      kind: 'image',
      previewUrl: attachment.previewUrl,
      alt: attachment.file.name || t('image.pending'),
      removeLabel: t('image.remove', { name: attachment.file.name }),
      attachment,
    })),
    ...textCards.map((card): ComposerRailItem => ({
      id: card.id,
      kind: 'text',
      alt: card.name,
      removeLabel: tAttachment === undefined
        ? t('image.remove', { name: card.name })
        : tAttachment('text.remove', { name: card.name }),
    })),
  ], [attachments, textCards, t, tAttachment])

  const groupLabel = attachments.length > 0 || tAttachment === undefined
    ? t('image.pending')
    : tAttachment('text.pending')

  return (
    <>
      {dragActive && (
        <DropOverlay
          disabled={!canAcceptDrop}
          labels={dropOverlayLabels(t, canAcceptDrop, dropLimits, tAttachment)}
        />
      )}
      {railItems.length > 0 && (
        <div className={css.rail}>
          <AttachmentRail
            items={railItems}
            labels={{ ...attachmentRailLabels(t), group: groupLabel }}
            onOpen={(item) => {
              if (item.attachment !== undefined) setPreview(item.attachment)
            }}
            onRemove={(item) => {
              if (item.kind === 'text') removeTextCard(item.id)
              else if (item.attachment !== undefined) onRemoveImage(item.attachment.id)
            }}
          />
        </div>
      )}
      {preview !== null && (
        <ImageLightbox
          src={preview.previewUrl}
          alt={preview.file.name || t('image.original')}
          labels={lightboxLabels(t)}
          onClose={closePreview}
        />
      )}
    </>
  )
}
