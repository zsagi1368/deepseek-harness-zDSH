import { memo, useMemo } from 'react'
import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { formatQuoteBlock } from '../input/quote.ts'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'

/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
export const AssistantNodeView = memo(function AssistantNodeView({
  node, useTurnData, useInput, inputActions, openFile, renderMessageImages, fileMentions, t,
}: ChatNodeViewProps<'assistant-step'>) {
  const data = node.data
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const tail = useTurnData('turn-tail')
  const owner = useMemo<TurnTailOwnerProps | undefined>(() => {
    if (turn?.status !== 'closed' || data.finalNode === undefined) return undefined
    if (tail?.closing?.finalNode.seq !== data.finalNode.seq) return undefined
    return { turn, seq: data.finalNode.seq, openFile }
  }, [data.finalNode, openFile, tail, turn])
  const mentions = useMemo(
    () => owner === undefined ? undefined : fileMentions(owner),
    [fileMentions, owner],
  )
  // S-30 selection quote: the affordance exists only while the composer can
  // accept one (plain phase, machine faces resident). The selector subscribes
  // this row to the input phase alone — draft keystrokes never re-render it.
  const phase = useInput(s => s.phase)
  const onQuote = useMemo(() => {
    if (inputActions?.appendQuote === undefined) return undefined
    return (text: string): void => { inputActions.appendQuote?.(formatQuoteBlock(text)) }
  }, [inputActions])
  return (
    <AssistantMarkdown
      blocks={data.blocks}
      streaming={data.status === 'running'}
      interrupted={data.status === 'interrupted'}
      renderMessageImages={renderMessageImages}
      mentions={mentions}
      {...onQuote === undefined ? {} : { onQuote }}
      quoteEnabled={phase === 'plain'}
      t={t}
    />
  )
})
