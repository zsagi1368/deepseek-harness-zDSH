/**
 * S-30 selection follow-up scope: one assistant text block wrapped in a
 * relative-positioned container that watches document selections. The
 * listener hangs on this block-level container (never on the rich renderer's
 * internal DOM), so it coexists with the per-block S-10 visibility boundary —
 * a crashed renderer degrades to its raw fallback inside the same scope and
 * the selection gesture keeps working over the fallback face.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { useThrottledVisualUpdate } from './use-throttled-visual-update.ts'
import css from './AssistantMarkdown.module.css'

/** Where a selection never summons the affordance: code blocks own copy. */
const CODE_SELECTION_GUARD = 'pre, .md-code-block'

/** Live affordance placement and payload, in scope-local coordinates. */
interface FloatingQuote {
  readonly top: number
  readonly left: number
  readonly text: string
}

/** Nearest element for a (possibly text) selection endpoint node. */
function elementOf(node: Node | null): Element | null {
  if (node === null) return null
  return node instanceof Element ? node : node.parentElement
}

/** Placement-only rectangle subset the pill needs. */
interface EndRect {
  readonly bottom: number
  readonly right: number
}

/**
 * Selection-end geometry. Browsers always implement Range.getBoundingClientRect;
 * jsdom (unit tests) does not, and there the zero rect keeps placement math
 * inert without affecting what the assertions observe.
 * @param range - the live selection range.
 * @returns the range's bounding rect, or zeros when the engine lacks the API.
 */
function endRectOf(range: Range): EndRect {
  const read = (range as unknown as { getBoundingClientRect?: () => EndRect }).getBoundingClientRect
  return read?.call(range) ?? { bottom: 0, right: 0 }
}

/**
 * Block-level selection scope with the floating follow-up pill.
 * @param props.enabled - whether the composer currently accepts quotes; when
 * false any live pill is dropped and new selections stay inert.
 * @param props.label - localized visible label and aria copy.
 * @param props.onQuote - called with the verbatim selection on confirmation.
 * @param props.children - the block render tree the listener watches.
 * @returns the scope wrapper with its floating affordance.
 */
export function FollowUpTextScope({ enabled, label, onQuote, children }: {
  enabled: boolean
  label: string
  onQuote: (text: string) => void
  children: ReactNode
}) {
  const scopeRef = useRef<HTMLDivElement>(null)
  const [floating, setFloating] = useState<FloatingQuote | null>(null)
  const hide = useCallback(() => { setFloating(null) }, [])

  // Selection events stream continuously during a drag; one frame of
  // coalescing keeps the evaluation off the hot path without perceptible lag.
  const scheduleEvaluate = useThrottledVisualUpdate(() => {
    const scope = scopeRef.current
    if (!enabled || scope === null) {
      hide()
      return
    }
    const selection = typeof document !== 'undefined' ? document.getSelection() : null
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0) {
      hide()
      return
    }
    const anchor = elementOf(selection.anchorNode)
    const focus = elementOf(selection.focusNode)
    if (anchor === null || focus === null || !scope.contains(anchor) || !scope.contains(focus)) {
      hide()
      return
    }
    // Code blocks carry their own copy gesture: a selection living inside one
    // never summons the follow-up pill (the S-30 gesture-conflict guard).
    if (anchor.closest(CODE_SELECTION_GUARD) !== null || focus.closest(CODE_SELECTION_GUARD) !== null) {
      hide()
      return
    }
    const text = selection.toString()
    if (text.trim() === '') {
      hide()
      return
    }
    const range = selection.getRangeAt(0)
    const end = endRectOf(range)
    const origin = scope.getBoundingClientRect()
    setFloating({
      top: Math.max(0, end.bottom - origin.top + 4),
      left: Math.max(0, end.right - origin.left),
      text,
    })
  }, 1)

  useEffect(() => {
    const evaluate = (): void => { scheduleEvaluate() }
    document.addEventListener('selectionchange', evaluate)
    // Pill coordinates are scope-relative snapshots of viewport geometry; any
    // scroll (transcript or page, capture phase covers inner scrollers) hides.
    window.addEventListener('scroll', hide, true)
    return () => {
      document.removeEventListener('selectionchange', evaluate)
      window.removeEventListener('scroll', hide, true)
    }
  }, [hide, scheduleEvaluate])

  // A busy composer (claim / admission flight) flips the gate off mid-gesture:
  // drop whatever is showing instead of leaving a control that cannot act.
  useEffect(() => {
    if (!enabled) hide()
  }, [enabled, hide])

  const onPillMouseDown = (e: MouseEvent<HTMLButtonElement>): void => {
    // Keep the reader's selection alive under the press (a focused pill would
    // collapse it before click).
    e.preventDefault()
  }

  return (
    <div ref={scopeRef} className={css.quoteScope} data-quote-scope>
      {children}
      {floating !== null && (
        <button
          type="button"
          className={css.followUp}
          style={{ top: floating.top, left: floating.left }}
          data-follow-up
          aria-label={label}
          onMouseDown={onPillMouseDown}
          onClick={() => {
            onQuote(floating.text)
            document.getSelection()?.removeAllRanges()
            hide()
          }}
        >
          {label}
        </button>
      )}
    </div>
  )
}
