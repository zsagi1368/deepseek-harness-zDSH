// AssistantMarkdown: renders assistant blocks in order — markdown text body,
// reasoning as the figma Think summary row (expand = indented gray text),
// other-block JSON fallback. Tool-call heads are NOT rendered here: the chat
// view groups them into tool rows through its keyed toolview slot (figma
// step-summary flow). Shared by finalized nodes and the streaming partial;
// the turn-level loading dots live in the chat view's tail, not here.
// Finalized content (text) nodes append IconActions once their turn ends
// (`time` is omitted for mid-turn narration and while the turn still runs);
// their branch action is enabled only when the node is also the completed
// turn's transcript tail. Think / tool-head-only nodes stay chrome-free.
//
// S-10 visibility guarantee: each rendered block sits behind a per-block
// visibility boundary, so a crashing rich renderer degrades to a raw-text /
// raw-JSON face instead of bubbling to the slot boundary whose empty crash
// div would make produced output vanish from the transcript.

import { Component, Fragment, memo, useMemo } from 'react'
import type { ReactNode } from 'react'
import type { AssistantBlock } from '@deepseek-ai/dsh-client-runtime/client'
import { JsonBlock, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MarkdownFileMentions } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeOwnerProps, ChatViewSlotProps } from '../contract/slots.ts'
import { FollowUpTextScope } from './FollowUpTextScope.tsx'
import { ReasoningRow } from './ReasoningRow.tsx'
import css from './AssistantMarkdown.module.css'

export interface AssistantMarkdownProps {
  blocks: readonly AssistantBlock[]
  streaming: boolean
  /** Frozen partial of an aborted turn: rendered with a stopped marker. */
  interrupted?: boolean | undefined
  /** Render consecutive image blocks through the attachment slot. */
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  /** Resolved prose file mentions for this Assistant's closing turn. */
  mentions?: MarkdownFileMentions | undefined
  /**
   * S-30: deliver a verbatim prose selection to the caller (the node view
   * forwards it to the session draft as one quote block). Omission renders
   * text blocks exactly as before — no selection scope wrapper.
   */
  onQuote?: ((text: string) => void) | undefined
  /**
   * Whether the composer currently accepts quotes (plain phase); gates the
   * floating affordance independently of the handler's existence.
   */
  quoteEnabled?: boolean | undefined
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

interface BlockVisibilityBoundaryProps {
  /** What paints instead of the crashed renderer; already localized/marked. */
  readonly fallback: ReactNode
  /** Payload identity: a changed token retries the real renderer once per value. */
  readonly resetToken: string
  readonly children: ReactNode
}

/**
 * Per-block error isolation for one assistant block. A render throw inside the
 * wrapped subtree swaps in `fallback` locally, keeping the block's content on
 * the record; sibling blocks and the surrounding entry stay untouched. The
 * boundary self-heals: when `resetToken` changes after a failure (fresh stream
 * delta or settled swap), it retries the real renderer — identical input would
 * just re-throw, so retry granularity is one attempt per new payload.
 */
class BlockVisibilityBoundary extends Component<BlockVisibilityBoundaryProps, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(error: unknown): void {
    console.error('assistant block render failed; showing raw fallback:', error)
  }

  override componentDidUpdate(previous: BlockVisibilityBoundaryProps): void {
    if (this.state.failed && previous.resetToken !== this.props.resetToken) {
      this.setState({ failed: false })
    }
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

/** Best-effort serialization for the unknown-block crash face. */
function RawJsonFallback({ payload }: { payload: unknown }) {
  let serialized: string
  try {
    // lib typing hides stringify's undefined arm (undefined/function/symbol payloads).
    // oxlint-disable-next-line typescript/no-unnecessary-condition
    serialized = JSON.stringify(payload, null, 2) ?? String(payload)
  } catch {
    serialized = String(payload)
  }
  return <pre className={css.rawFallback} data-assistant-fallback="json">{serialized}</pre>
}

/** Reasoning block as the Think variant summary row (figma 39:28304). */
export const AssistantMarkdown = memo(function AssistantMarkdown({
  blocks, streaming, interrupted, renderMessageImages, mentions, onQuote, quoteEnabled, t,
}: AssistantMarkdownProps) {
  // Stable per locale revision (t identity changes on switch): a fresh object
  // per render would rebuild MarkdownText's component table every chunk.
  const codeLabels = useMemo(() => ({ copyLabel: t('copy'), copiedLabel: t('copied') }), [t])
  const last = blocks.length - 1
  // Tool-call heads render as tool rows in the chat view's grouping pass, so
  // a node that is only those heads (or empty) would paint an empty root
  // between tool groups — skip the shell unless something visible remains.
  const hasVisible = streaming
    || interrupted === true
    || blocks.some(block => block.kind !== 'tool-call')
  if (!hasVisible) return null
  const rendered: ReactNode[] = []
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]
    if (block === undefined) continue
    switch (block.kind) {
      case 'text': {
        const body = (
          <BlockVisibilityBoundary
            resetToken={block.text}
            fallback={<pre className={css.rawFallback} data-assistant-fallback="text">{block.text}</pre>}
          >
            <MarkdownText
              text={block.text}
              streaming={streaming}
              codeLabels={codeLabels}
              fileMentions={mentions}
            />
          </BlockVisibilityBoundary>
        )
        // S-30: with a quote handler the text block sits inside its selection
        // scope (the listener hangs on this block-level container, outside the
        // visibility boundary, so the raw crash fallback stays selectable too);
        // without one the DOM is exactly the pre-feature shape.
        rendered.push(
          onQuote === undefined ? (
            <Fragment key={i}>{body}</Fragment>
          ) : (
            <FollowUpTextScope
              key={i}
              enabled={quoteEnabled === true}
              label={t('message.followUp')}
              onQuote={onQuote}
            >
              {body}
            </FollowUpTextScope>
          ),
        )
        break
      }
      case 'reasoning':
        rendered.push(
          <BlockVisibilityBoundary
            key={i}
            resetToken={block.text}
            fallback={<pre className={css.rawFallback} data-assistant-fallback="reasoning">{block.text}</pre>}
          >
            <ReasoningRow text={block.text} running={streaming && i === last} t={t} />
          </BlockVisibilityBoundary>,
        )
        break
      case 'image': {
        // Consecutive image blocks share one gallery so several images tile
        // into rows instead of each opening a one-image group of its own.
        // Keyed by the group's FIRST block index: a streaming append that
        // extends the group then only grows `images` instead of remounting
        // the gallery under a shifted key.
        const start = i
        const group = [block]
        while (i + 1 < blocks.length) {
          const next = blocks[i + 1]
          if (next === undefined || next.kind !== 'image') break
          group.push(next)
          i += 1
        }
        rendered.push(
          <Fragment key={start}>
            {renderMessageImages({
              images: group.map(({ attachment }) => ({ attachment })),
              align: 'start',
            })}
          </Fragment>,
        )
        break
      }
      // Grouped into tool rows by ChatView; hasVisible above skips an empty shell.
      case 'tool-call':
        break
      default:
        rendered.push(
          <BlockVisibilityBoundary
            key={i}
            resetToken={String(i)}
            fallback={<RawJsonFallback payload={block.block} />}
          >
            <JsonBlock
              label={t('message.unknownBlock')}
              payload={block.block}
              truncatedLabel={total => t('json.truncated', { total })}
            />
          </BlockVisibilityBoundary>,
        )
    }
  }
  return (
    <div className={css.root} data-streaming={streaming || undefined}>
      <div className={css.body}>
        {rendered}
        {interrupted && <span className={css.stopped}>{t('message.stopped')}</span>}
      </div>
    </div>
  )
})
