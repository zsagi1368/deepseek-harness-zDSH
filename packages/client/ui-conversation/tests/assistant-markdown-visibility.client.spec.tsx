// @vitest-environment jsdom
// S-10 rendering matrix: every streaming-partial shape an assistant step can
// present must leave visible output (or a deliberate empty shell) — never a
// silently vanished text block. Drives AssistantMarkdown directly, the exact
// component the chat seat mounts for running/settled/interrupted steps.
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { AssistantBlock } from '@deepseek-ai/dsh-client-runtime/client'
import { AssistantMarkdown, type AssistantMarkdownProps } from '../src/client/chat/AssistantMarkdown.tsx'
import { zh } from '../src/client/locales.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh)
const renderMessageImages: AssistantMarkdownProps['renderMessageImages'] = () => null

function mount(
  blocks: readonly AssistantBlock[],
  streaming: boolean,
  interrupted?: boolean,
): HTMLElement {
  return render(
    <AssistantMarkdown
      t={t}
      blocks={blocks}
      streaming={streaming}
      interrupted={interrupted}
      renderMessageImages={renderMessageImages}
    />,
  ).container
}

const toolCall: AssistantBlock = { kind: 'tool-call', callId: 'call-1', name: 'read_file', argsRaw: '{}' }

describe('AssistantMarkdown visibility matrix (S-10)', () => {
  it('streams plain prose visibly', () => {
    expect(mount([{ kind: 'text', text: 'Hello world' }], true).textContent).toContain('Hello world')
  })

  it('keeps the shell for an empty leading text block without crashing', () => {
    const root = mount([{ kind: 'text', text: '' }], true)
    expect(root.querySelector('[data-streaming]')).not.toBeNull()
  })

  it('keeps the shell for a whitespace-only text block without crashing', () => {
    const root = mount([{ kind: 'text', text: '  \n\t ' }], false)
    expect(root.querySelector('.body, [class*="body"]')).not.toBeNull()
  })

  it('shows fence content while a code fence streams unclosed at the reply start', () => {
    const root = mount([{ kind: 'text', text: '```ts\nconst answer = 42' }], true)
    expect(root.textContent).toContain('const answer = 42')
  })

  it('shows prose that follows a closed fence mid-stream', () => {
    const root = mount([{ kind: 'text', text: '```ts\nconst a = 1\n```\nAfter the fence' }], true)
    expect(root.textContent).toContain('const a = 1')
    expect(root.textContent).toContain('After the fence')
  })

  it('renders reasoning-then-text sandwich: Think row plus visible answer', () => {
    const root = mount([
      { kind: 'reasoning', text: 'weighing options' },
      { kind: 'text', text: 'The answer is seven' },
    ], true)
    expect(root.textContent).toContain('Think')
    expect(root.textContent).toContain('The answer is seven')
  })

  it('marks only the trailing reasoning block as running in a text-reasoning-text stream', () => {
    const root = mount([
      { kind: 'text', text: 'first part' },
      { kind: 'reasoning', text: 'mid-turn thinking' },
      { kind: 'text', text: 'second part' },
    ], true)
    expect(root.textContent).toContain('first part')
    expect(root.textContent).toContain('second part')
  })

  it('renders both prose halves around a tool-call head in one partial', () => {
    const root = mount([
      { kind: 'text', text: 'Let me check the file' },
      toolCall,
      { kind: 'text', text: 'Done checking' },
    ], true)
    expect(root.textContent).toContain('Let me check the file')
    expect(root.textContent).toContain('Done checking')
  })

  it('skips the shell for a settled tool-head-only node (tool rows own the flow)', () => {
    expect(mount([toolCall], false).querySelector('[data-streaming]')).toBeNull()
  })

  it('falls back to the JSON face for unknown block kinds instead of dropping them', () => {
    const root = mount([
      { kind: 'text', text: 'before unknown' },
      { kind: 'other', block: { type: 'mystery', x: 1 } },
    ], true)
    expect(root.textContent).toContain('before unknown')
    expect(root.textContent).toContain('未知内容块')
  })

  it('renders consecutive text blocks each on their own key', () => {
    const root = mount([
      { kind: 'text', text: 'alpha block' },
      { kind: 'text', text: 'beta block' },
    ], true)
    expect(root.textContent).toContain('alpha block')
    expect(root.textContent).toContain('beta block')
  })

  it('keeps interrupted partial prose visible with the stopped marker', () => {
    const root = mount([{ kind: 'text', text: 'frozen mid-sentence' }], false, true)
    expect(root.textContent).toContain('frozen mid-sentence')
    expect(root.textContent).toContain('已停止')
  })
})
