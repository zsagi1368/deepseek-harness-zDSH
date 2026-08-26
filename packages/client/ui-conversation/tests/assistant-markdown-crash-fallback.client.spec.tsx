// @vitest-environment jsdom
// S-10 guarantee: assistant output must never vanish. When a rich renderer
// crashes mid-render, AssistantMarkdown degrades each block to a raw text /
// JSON face locally instead of letting the slot-level error boundary blank the
// whole entry (its crash face is an empty div). Also verifies self-healing:
// fresh stream deltas retry the real renderer.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { AssistantBlock } from '@deepseek-ai/dsh-client-runtime/client'
import { AssistantMarkdown, type AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'
import { zh } from '../src/client/locales.ts'

const CRASH_MARKER = 'dsh-crash-probe'
const CRASH_JSON_MARKER = 'dsh-crash-json-probe'

// Replace only the two leaf faces with probes: MarkdownText throws on the text
// marker, JsonBlock on the payload marker; everything else stays real.
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@deepseek-ai/dsh-client-ui-primitives')>()
  return {
    ...actual,
    MarkdownText: ({ text }: { text: string }) => {
      if (text.includes(CRASH_MARKER)) throw new Error('markdown face crashed')
      return <div>{text}</div>
    },
    JsonBlock: ({ label, payload }: { label: string; payload: unknown }) => {
      if (
        typeof payload === 'object' && payload !== null
        && (payload as Record<string, unknown>)['type'] === CRASH_JSON_MARKER
      ) throw new Error('json face crashed')
      return <button type="button">{label}</button>
    },
  }
})

afterEach(cleanup)

const t = makeTranslate(zh, commonZh)
const renderMessageImages: AssistantMarkdownProps['renderMessageImages'] = () => null

function mount(blocks: readonly AssistantBlock[], streaming: boolean) {
  return render(
    <AssistantMarkdown
      t={t}
      blocks={blocks}
      streaming={streaming}
      renderMessageImages={renderMessageImages}
    />,
  )
}

describe('AssistantMarkdown per-block visibility fallback (S-10)', () => {
  it('degrades a crashing text block to raw text instead of dropping it', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const view = mount([{ kind: 'text', text: `before ${CRASH_MARKER} after` }], true)
      const fallback = view.container.querySelector('[data-assistant-fallback="text"]')
      expect(fallback).not.toBeNull()
      expect(fallback?.textContent).toBe(`before ${CRASH_MARKER} after`)
      expect(view.container.querySelector('[data-slot-error]')).toBeNull()
    } finally {
      spy.mockRestore()
    }
  })

  it('one crashed block does not blank its siblings', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const view = mount([
        { kind: 'text', text: 'healthy lead' },
        { kind: 'text', text: `${CRASH_MARKER} broken middle` },
        { kind: 'text', text: 'healthy tail' },
      ], true)
      expect(view.container.textContent).toContain('healthy lead')
      expect(view.container.querySelector('[data-assistant-fallback="text"]')?.textContent)
        .toContain(`${CRASH_MARKER} broken middle`)
      expect(view.container.textContent).toContain('healthy tail')
    } finally {
      spy.mockRestore()
    }
  })

  it('a fresh stream delta retries the real renderer after a crash', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const view = mount([{ kind: 'text', text: `${CRASH_MARKER} partial` }], true)
      expect(view.container.querySelector('[data-assistant-fallback="text"]')).not.toBeNull()
      view.rerender(
        <AssistantMarkdown
          t={t}
          blocks={[{ kind: 'text', text: 'partial now streams safely' }]}
          streaming
          renderMessageImages={renderMessageImages}
        />,
      )
      expect(view.container.querySelector('[data-assistant-fallback="text"]')).toBeNull()
      expect(view.container.textContent).toContain('partial now streams safely')
    } finally {
      spy.mockRestore()
    }
  })

  it('degrades a crashing unknown-block face to serialized JSON', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const payload = { type: CRASH_JSON_MARKER, detail: 'keep me visible' }
      const view = mount([
        { kind: 'other', block: payload },
        { kind: 'other', block: { type: 'plain', x: 1 } },
      ], true)
      const fallback = view.container.querySelector('[data-assistant-fallback="json"]')
      expect(fallback?.textContent).toContain('"type": "dsh-crash-json-probe"')
      expect(fallback?.textContent).toContain('keep me visible')
      expect(view.container.textContent).toContain('未知内容块')
    } finally {
      spy.mockRestore()
    }
  })
})
