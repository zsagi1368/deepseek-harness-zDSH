// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactElement } from 'react'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import { AssistantMarkdown, type AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'
import { zh } from '../src/client/locales.ts'

let nextAnimationFrameId = 1
let animationFrames = new Map<number, FrameRequestCallback>()

function flushAnimationFrames(count: number): void {
  for (let index = 0; index < count; index += 1) {
    const callbacks = [...animationFrames.values()]
    animationFrames.clear()
    for (const callback of callbacks) callback(index)
  }
}

beforeEach(() => {
  nextAnimationFrameId = 1
  animationFrames = new Map()
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    const id = nextAnimationFrameId
    nextAnimationFrameId += 1
    animationFrames.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    animationFrames.delete(id)
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const t = makeTranslate(zh, commonZh)
const renderMessageImages: AssistantMarkdownProps['renderMessageImages'] = () => null

describe('ReasoningRow', () => {
  it('follows the latest streaming line, scrolls to its end, then restores the settled first line', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nNewest reasoning tokens' }]}
        streaming
        renderMessageImages={renderMessageImages}
      />,
    )
    expect(view.getByText('运行中')).toBeTruthy()
    const summary = view.getByText('Newest reasoning tokens')
    Object.defineProperties(summary, {
      scrollWidth: { configurable: true, value: 300 },
      clientWidth: { configurable: true, value: 100 },
    })

    view.rerender(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nNewest reasoning tokens keep arriving' }]}
        streaming
        renderMessageImages={renderMessageImages}
      />,
    )
    expect(summary.scrollLeft).toBe(0)
    flushAnimationFrames(2)
    expect(summary.scrollLeft).toBe(0)
    flushAnimationFrames(1)
    expect(summary.scrollLeft).toBe(200)
    expect(summary.getAttribute('data-follow-end')).toBe('true')

    view.rerender(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nNewest reasoning tokens keep arriving\n' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    flushAnimationFrames(3)
    expect(view.getByText('Inspect the session')).toBeTruthy()
    expect(view.queryByText('运行中')).toBeNull()
    expect(summary.scrollLeft).toBe(0)
    expect(summary.hasAttribute('data-follow-end')).toBe(false)
  })

  it('expands from either Think or the reasoning summary', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nCheck persistence' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    const row = view.getByRole('button')

    fireEvent.click(view.getByText('Inspect the session'))
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(view.getByText(/Check persistence/)).toBeTruthy()

    fireEvent.click(view.getByText('Think'))
    expect(row.getAttribute('aria-expanded')).toBe('false')
  })

  it('expanded Think drops the inline summary and renders plain prose, no IN card', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'reasoning', text: 'Inspect the session\nCheck persistence' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    fireEvent.click(view.getByText('Think'))
    expect(view.getAllByText(/Inspect the session/)).toHaveLength(1)
    expect(view.queryByText('IN')).toBeNull()
    expect(view.container.querySelector('[class*="ioCard"]')).toBeNull()
    expect(view.container.querySelector('[class*="thinkBody"]')).not.toBeNull()
  })
})

describe('ReasoningRow S-41 reading ergonomics', () => {
  /** Mount the transcript under a conversation-scroll host with faked metrics,
   * exactly how ChatView resolves the scrollport in production nesting. */
  function mountInScrollHost(ui: ReactElement) {
    const host = document.createElement('div')
    host.setAttribute('data-conversation-scroll', '')
    document.body.appendChild(host)
    const metrics = { scrollHeight: 2_000, clientHeight: 600, scrollTop: 0 }
    Object.defineProperties(host, {
      scrollHeight: { configurable: true, get: () => metrics.scrollHeight },
      clientHeight: { configurable: true, get: () => metrics.clientHeight },
      scrollTop: {
        configurable: true,
        get: () => metrics.scrollTop,
        set: (value: number) => {
          metrics.scrollTop = Math.max(0, Math.min(value, metrics.scrollHeight - metrics.clientHeight))
        },
      },
    })
    const view = render(ui, { container: host })
    return { host, view, metrics }
  }

  afterEach(() => {
    document.querySelectorAll('[data-conversation-scroll]').forEach((node) => {
      node.remove()
    })
  })

  it('expanding never forces a scroll toward the message head; the head row pins via data-expanded', () => {
    const rootTop = 120
    const { host, view, metrics } = mountInScrollHost(
      <AssistantMarkdown
        t={t}
        blocks={[
          { kind: 'reasoning', text: 'Long thinking text\n'.repeat(40) },
          { kind: 'text', text: 'The answer follows.' },
        ]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    metrics.scrollTop = 400
    const rects = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === host) return { top: 0, bottom: 600 } as DOMRect
      if (this.dataset.variant === 'think') return { top: rootTop, bottom: rootTop + 24 } as DOMRect
      return { top: rootTop + 500, bottom: rootTop + 540 } as DOMRect
    })
    try {
      fireEvent.click(view.getByText('Think'))
      const root = host.querySelector('[data-variant="think"]') as HTMLElement
      // Sticky hook: the expanded head row exposes its pinned state to CSS.
      expect(root.dataset.expanded).toBe('true')
      expect(root.querySelector('[class*="thinkBody"]')).not.toBeNull()
      // No forced scroll in either direction: the clicked header keeps its
      // exact viewport position through the height change.
      expect(metrics.scrollTop).toBe(400)

      // Collapsing while the answer below was NOT visible anchors back to the
      // header itself (the reader is looking inside the Think block region).
      rects.mockReset()
      rects.mockImplementation(function (this: HTMLElement) {
        if (this === host) return { top: 0, bottom: 600 } as DOMRect
        if (this.dataset.variant === 'think') return { top: 80, bottom: 104 } as DOMRect
        return { top: 980, bottom: 1_020 } as DOMRect
      })
      fireEvent.click(view.getByText('Think'))
      expect((host.querySelector('[data-variant="think"]') as HTMLElement).dataset.expanded).toBeUndefined()
      // Header stays put (delta 0): no jump to any message head.
      expect(metrics.scrollTop).toBe(400)
    } finally {
      rects.mockRestore()
    }
  })

  it('collapsing with the following block already visible keeps that block under the viewport', () => {
    const { host, view, metrics } = mountInScrollHost(
      <AssistantMarkdown
        t={t}
        blocks={[
          { kind: 'reasoning', text: 'Long thinking text\n'.repeat(40) },
          { kind: 'text', text: 'The answer follows.' },
        ]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    // Phase-aware geometry: while the Think root still carries data-expanded
    // (toggle-time capture) the answer block sits at viewport-relative 90;
    // after the collapse commits (engines without native scroll anchoring)
    // the block has lifted by the full 640px body height.
    const rects = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this === host) return { top: 0, bottom: 600 } as DOMRect
      if (this.dataset.variant === 'think') return { top: -510, bottom: -486 } as DOMRect
      const expandedPhase = host.querySelector<HTMLElement>('[data-variant="think"]')?.dataset.expanded !== undefined
      return { top: expandedPhase ? 90 : -550, bottom: expandedPhase ? 130 : -510 } as DOMRect
    })
    try {
      // Reader has scrolled deep into the thinking pass: the header is far
      // above the viewport and the answer's first lines are visible (90 < 600).
      metrics.scrollTop = 800
      fireEvent.click(view.getByText('Think'))
      expect(metrics.scrollTop).toBe(800)
      fireEvent.click(view.getByText('Think'))
      // Anchor = the visible answer block: it keeps its viewport-relative top
      // (90), so the scroll compensates the whole 640px lift instead of
      // letting the view fall back onto the message head.
      expect(metrics.scrollTop).toBe(160)
    } finally {
      rects.mockRestore()
    }
  })
})
