// @vitest-environment jsdom
// S-30 selection follow-up: pure quote formatting, the composer-side
// append transaction, and the block-level selection scope behavior
// (appearance, injection handoff, code-block gesture conflict, busy gate).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { CommandClaim } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import { AssistantMarkdown, type AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'
import { SessionInputShell } from '../src/client/input/facade.ts'
import { composeQuotedDraft, formatQuoteBlock } from '../src/client/input/quote.ts'
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
  window.getSelection()?.removeAllRanges()
  vi.unstubAllGlobals()
})

const t = makeTranslate(zh, commonZh)
const renderMessageImages: AssistantMarkdownProps['renderMessageImages'] = () => null

/** Select the full contents of `element` and announce it to listeners. */
function selectContents(element: Element): void {
  const selection = window.getSelection()
  if (selection === null) throw new Error('jsdom exposes no selection')
  const range = document.createRange()
  range.selectNodeContents(element)
  selection.removeAllRanges()
  selection.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
}

function clearSelection(): void {
  window.getSelection()?.removeAllRanges()
  document.dispatchEvent(new Event('selectionchange'))
}

describe('quote formatting', () => {
  it('formats selections as markdown blockquote lines across newline styles', () => {
    expect(formatQuoteBlock('single line')).toBe('> single line')
    expect(formatQuoteBlock('first\nsecond\nthird')).toBe('> first\n> second\n> third')
    expect(formatQuoteBlock('win\r\nlines')).toBe('> win\n> lines')
    expect(formatQuoteBlock('   padded  \n')).toBe('> padded')
    expect(formatQuoteBlock('   \n\t')).toBe('')
  })

  it('composes the next draft: quotes join after a blank line or replace an empty draft', () => {
    expect(composeQuotedDraft('', '> quoted')).toBe('> quoted')
    expect(composeQuotedDraft('my question', '> quoted')).toBe('my question\n\n> quoted')
  })
})

describe('composer appendQuote', () => {
  function makeShell(): SessionInputShell {
    return new SessionInputShell({
      actx: {} as ClientContext,
      defaultSink: () => Promise.resolve({ kind: 'success' }),
      commandImages: {
        serialize: () => Promise.resolve([]),
        release: () => {},
        unsupportedNotice: () => 'unsupported',
      },
    })
  }

  /** Narrow the optional capability: these cases exercise a shell that has it. */
  function requireAppendQuote(shell: SessionInputShell): (text: string) => boolean {
    return (text) => {
      const result = shell.actions.appendQuote?.(text)
      if (result === undefined) throw new Error('appendQuote unavailable on this shell')
      return result
    }
  }

  it('appends to an existing draft as one plain-phase transaction', () => {
    const shell = makeShell()
    shell.setDraft('my question')
    expect(requireAppendQuote(shell)('> quoted passage')).toBe(true)
    expect(shell.snapshot.draft).toBe('my question\n\n> quoted passage')
    // One undo returns to the pre-quote draft (the append rode the machine).
    shell.undo()
    expect(shell.snapshot.draft).toBe('my question')
  })

  it('replaces an empty draft and refuses blank blocks', () => {
    const shell = makeShell()
    expect(requireAppendQuote(shell)('> quoted')).toBe(true)
    expect(shell.snapshot.draft).toBe('> quoted')
    expect(requireAppendQuote(shell)('   \n')).toBe(false)
    expect(shell.snapshot.draft).toBe('> quoted')
  })

  it('refuses while a claim holds the draft (the append may not cross a command span)', () => {
    const shell = makeShell()
    shell.setDraft('say hi')
    const rev = shell.snapshot.draftRev
    // beginCommand never reaches the submit closure, so an unsettled stub is safe.
    const claim: CommandClaim = { token: '/plan', submit: () => new Promise(() => {}) }
    expect(shell.beginCommand(claim, { start: 0, end: 6, draftRev: rev })).toBe(true)
    expect(shell.snapshot.phase).toBe('claimed')
    expect(requireAppendQuote(shell)('> quoted')).toBe(false)
    expect(shell.snapshot.draft).toBe('/plan')
  })
})

describe('FollowUpTextScope over assistant text blocks', () => {
  it('summons the pill from a prose selection and hands the verbatim text to onQuote', () => {
    const onQuote = vi.fn()
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'text', text: 'A fact worth quoting.' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
        onQuote={onQuote}
        quoteEnabled
      />,
    )
    // Selection events fire outside React's knowledge; the resulting pill
    // commit must be flushed inside act for the assertions below.
    act(() => {
      selectContents(view.getByText('A fact worth quoting.'))
      flushAnimationFrames(2)
    })
    const pill = view.container.querySelector('[data-follow-up]') as HTMLButtonElement | null
    expect(pill).not.toBeNull()
    expect(pill?.textContent).toBe('追问')
    expect(pill?.getAttribute('aria-label')).toBe('追问')

    fireEvent.click(pill as HTMLButtonElement)
    expect(onQuote).toHaveBeenCalledTimes(1)
    expect(onQuote).toHaveBeenCalledWith('A fact worth quoting.')
    // The affordance is single-shot: confirmation clears it and the selection.
    expect(view.container.querySelector('[data-follow-up]')).toBeNull()
    expect(window.getSelection()?.isCollapsed).toBe(true)
  })

  it('hides on collapsed selections and never engages while the composer gate is shut', () => {
    const onQuote = vi.fn()
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'text', text: 'Selectable prose body.' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
        onQuote={onQuote}
        quoteEnabled={false}
      />,
    )
    act(() => {
      selectContents(view.getByText('Selectable prose body.'))
      flushAnimationFrames(2)
    })
    expect(view.container.querySelector('[data-follow-up]')).toBeNull()

    // Gate open, then collapse mid-gesture: the pill retreats immediately.
    view.rerender(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'text', text: 'Selectable prose body.' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
        onQuote={onQuote}
        quoteEnabled
      />,
    )
    act(() => { flushAnimationFrames(2) })
    act(() => {
      selectContents(view.getByText('Selectable prose body.'))
      flushAnimationFrames(2)
    })
    expect(view.container.querySelector('[data-follow-up]')).not.toBeNull()
    act(() => {
      clearSelection()
      flushAnimationFrames(2)
    })
    expect(view.container.querySelector('[data-follow-up]')).toBeNull()
    expect(onQuote).not.toHaveBeenCalled()
  })

  it('leaves code-block selections alone yet still serves prose in the same block', () => {
    const onQuote = vi.fn()
    const markdown = '```js\nconst a = 1\n```\nProse tail after the code.'
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'text', text: markdown }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
        onQuote={onQuote}
        quoteEnabled
      />,
    )
    const codeHost = view.container.querySelector('.md-code-block pre') ?? view.container.querySelector('pre')
    expect(codeHost).not.toBeNull()
    act(() => {
      selectContents(codeHost as Element)
      flushAnimationFrames(2)
    })
    // The code block owns its own copy gesture: no follow-up pill.
    expect(view.container.querySelector('[data-follow-up]')).toBeNull()

    act(() => {
      selectContents(view.getByText('Prose tail after the code.'))
      flushAnimationFrames(2)
    })
    const pill = view.container.querySelector('[data-follow-up]') as HTMLButtonElement | null
    expect(pill).not.toBeNull()
    fireEvent.click(pill as HTMLButtonElement)
    expect(onQuote).toHaveBeenCalledWith('Prose tail after the code.')
  })

  it('renders text blocks without any scope wrapper when no quote handler exists', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'text', text: 'Plain legacy shape.' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
      />,
    )
    expect(view.container.querySelector('[data-quote-scope]')).toBeNull()
    expect(view.getByText('Plain legacy shape.')).toBeTruthy()
  })
})
