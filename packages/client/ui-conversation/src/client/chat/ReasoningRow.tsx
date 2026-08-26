/** Assistant reasoning disclosure, independent of Tool-call presentation. */
import { useLayoutEffect, useRef, useState } from 'react'
import { DisclosureRow, IconThinkOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { useThrottledVisualUpdate } from './use-throttled-visual-update.ts'
import a11yCss from './accessibility.module.css'
import css from './ReasoningRow.module.css'

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

function latestLine(text: string): string {
  const visible = text.trimEnd()
  const newline = visible.lastIndexOf('\n')
  return newline === -1 ? visible : visible.slice(newline + 1)
}

/**
 * The transcript scrollport governing `from` when the view is nested under
 * the conversation host; standalone mounts (isolated previews, unit tests)
 * resolve nothing and skip anchor bookkeeping.
 * @param from - element inside the transcript flow.
 * @returns the scrollport element, or null when the flow is not nested.
 */
function scrollportOf(from: HTMLElement): HTMLElement | null {
  return from.closest<HTMLElement>('[data-conversation-scroll]')
}

/**
 * Top of `element` measured in the scrollport's viewport coordinates
 * (independent of the page viewport, so reader-relative comparisons are stable).
 * @param element - flow element to measure.
 * @param scrollport - the governing transcript scrollport.
 * @returns the element's top relative to the scrollport's top edge.
 */
function viewportTopOf(element: HTMLElement, scrollport: HTMLElement): number {
  return element.getBoundingClientRect().top - scrollport.getBoundingClientRect().top
}

/** Reader anchor captured at toggle time: an element plus its viewport-relative top. */
interface ToggleAnchor {
  readonly element: HTMLElement
  readonly top: number
}

/**
 * Render one assistant reasoning block as the Think disclosure row.
 *
 * S-41 reading ergonomics: while expanded the head row pins (sticky) under the
 * scrollport's top edge so long thinking text keeps its header visible, and the
 * expand/collapse toggle re-anchors the scroll position instead of letting the
 * height change move the reader — expanding never forces a scroll back toward
 * the message head, and collapsing cannot yank already-visible answer content
 * out from under the viewport. Streaming auto-follow stays senior: the one-shot
 * anchor correction happens in a layout effect, after which ChatView's pinned
 * follow owns any further stream growth (single correction, no jitter loop).
 * @param props.text - complete or streaming reasoning text.
 * @param props.running - whether this block is the streaming tail.
 * @param props.t - conversation locale seat for the running status.
 * @returns the reasoning disclosure.
 */
export function ReasoningRow({ text, running, t }: { text: string; running: boolean; t: ChatViewSlotProps['t'] }) {
  const [expanded, setExpanded] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  /** Toggle-time reader anchor, consumed by the post-toggle layout effect. */
  const pendingAnchorRef = useRef<ToggleAnchor | null>(null)
  const summaryRef = useRef<HTMLSpanElement>(null)
  const summary = running ? latestLine(text) : firstLine(text)
  const scheduleSummaryScroll = useThrottledVisualUpdate(() => {
    const element = summaryRef.current
    if (element === null) return
    element.scrollLeft = running ? element.scrollWidth - element.clientWidth : 0
  })
  useLayoutEffect(() => {
    scheduleSummaryScroll()
  }, [running, scheduleSummaryScroll, summary])

  // Capture before the state flip commits: expanding anchors to the Think row
  // itself (the header the reader just clicked stays exactly where it was);
  // collapsing anchors to the following sibling block whenever that block was
  // already partially visible, because removing the body below the header
  // would otherwise lift that visible content by the body's height on engines
  // without native scroll anchoring.
  const toggleExpanded = (): void => {
    const root = rootRef.current
    if (root !== null) {
      const scrollport = scrollportOf(root)
      if (scrollport !== null) {
        let element: HTMLElement = root
        if (expanded) {
          const next = root.nextElementSibling
          if (next instanceof HTMLElement && viewportTopOf(next, scrollport) < scrollport.clientHeight) {
            element = next
          }
        }
        pendingAnchorRef.current = { element, top: viewportTopOf(element, scrollport) }
      }
    }
    setExpanded(value => !value)
  }

  // One-shot restore after the DOM settles; never runs for streaming text
  // growth (it keys on `expanded`), and a missing scrollport drops silently.
  useLayoutEffect(() => {
    const anchor = pendingAnchorRef.current
    pendingAnchorRef.current = null
    if (anchor === null) return
    const scrollport = scrollportOf(anchor.element)
    if (scrollport === null) return
    const delta = viewportTopOf(anchor.element, scrollport) - anchor.top
    if (Math.abs(delta) > 0.5) scrollport.scrollTop += delta
  }, [expanded])

  return (
    <div ref={rootRef} className={css.root} data-variant="think" data-state={running ? 'running' : 'ok'} data-expanded={expanded || undefined}>
      {running && <span className={a11yCss.visuallyHidden}>{t('row.running')}</span>}
      <DisclosureRow
        rowClassName={css.row}
        leadingClassName={css.leading}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={<IconThinkOutline14 size={14} />}
        title="Think"
        open={expanded}
        expandable
        expandOnRowClick
        onToggle={toggleExpanded}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden />
            <span ref={summaryRef} className={css.summary} data-follow-end={running || undefined}>{summary}</span>
          </>
        )}
      >
        <div className={css.thinkBody}>{text}</div>
      </DisclosureRow>
    </div>
  )
}
