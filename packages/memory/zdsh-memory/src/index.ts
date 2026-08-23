/**
 * @deepseek-ai/dsh-agent-memory — cross-session heuristic memory.
 *
 * The plugin watches the session event stream (`session/event`), extracts
 * memory entries with zero-LLM rules (decisions, corrective preferences, and
 * assistant conclusion facts — see `./extract.ts`), persists them in daily
 * shards under the branch home (`DSH_BRANCH_HOME` convention, see
 * `@deepseek-ai/dsh-plugin-governance`), and registers an `agent:memory`
 * system-prompt section that injects the Top-K keyword-overlap matches for the
 * current task. The Cordis `agentMemory` service exposes `list()`/`forget(id)`
 * for future UI or Remote surfaces; this package ships no Remote of its own.
 *
 * Model-visible ⟺ logged: injected text rides the assembled system prompt,
 * which the agent loop logs verbatim in `request/header.system`; nothing
 * reaches the model outside that logged channel.
 * @module @deepseek-ai/dsh-agent-memory
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Session, SessionEvent, UserMessage } from '@deepseek-ai/dsh-session'
import type { AssembleContext } from '@deepseek-ai/dsh-system-prompt'
import { extractAssistantCandidate, extractUserCandidates } from './extract.ts'
import { resolveMemoryRoot } from './home.ts'
import {
  KEYWORD_SCAN_MESSAGES,
  MEMORY_SECTION_NAME,
  MEMORY_SECTION_ORDER,
  renderMemorySection,
  selectTopK,
  tokenize,
} from './score.ts'
import { MemoryStore } from './store.ts'
import type { MemoryEntry } from './types.ts'

export { DSH_BRANCH_DIR_NAME, DSH_BRANCH_HOME_ENV, MEMORY_DIR_NAME, resolveBranchHome, resolveMemoryRoot } from './home.ts'
export { DEFAULT_MEMORY_CAPACITY, MemoryStore, dateKeyOf, evictToCapacity } from './store.ts'
export {
  KEYWORD_SCAN_MESSAGES,
  MEMORY_SECTION_NAME,
  MEMORY_SECTION_ORDER,
  renderMemorySection,
  selectTopK,
  tokenize,
} from './score.ts'
export {
  DECISION_CUE,
  MAX_PREFERENCES_PER_MESSAGE,
  MEMORY_TEXT_MAX_CHARS,
  PREFERENCE_CUE,
  codeBlockStats,
  extractAssistantCandidate,
  extractUserCandidates,
  truncateMemoryText,
} from './extract.ts'
export type { CodeBlockStats } from './extract.ts'
export type { MemoryCandidate, MemoryEntry, MemoryKind, MemoryShardFile } from './types.ts'

/** Stable Cordis plugin name. */
export const name = 'agent-memory'

/** No declared injections: the systemPrompt section mounts through `ctx.inject`. */
export const inject: string[] = []

/** Plugin config: storage placement, retention cap, and injection width. */
export interface Config {
  /** Explicit shard root overriding `<branch-home>/memory` (tests and deployments). */
  storageRoot?: string
  /** Global entry cap across shards; appending past it evicts the oldest entries FIFO. */
  capacity?: number
  /** Maximum entries injected into one prompt assembly (Top-K). */
  topK?: number
}

export const Config: z<Config> = z.object({
  storageRoot: z.string().default(''),
  capacity: z.natural().min(1).default(500),
  topK: z.natural().default(8),
})

declare module '@deepseek-ai/cordis' {
  interface Context {
    agentMemory: AgentMemoryService
  }
}

/** Concatenate one message's text blocks into the plain text the rules read. */
function messageText(content: UserMessage['content']): string {
  return content
    .filter((block): block is Extract<typeof block, { type: 'text' }> => block.type === 'text')
    .map(block => block.text)
    .join('')
}

/**
 * Derive the current task's keywords: tokens over the most recent human
 * prompts of the assembling session (plugin-injected context never counts).
 */
export function taskKeywords(events: readonly SessionEvent[], scan: number = KEYWORD_SCAN_MESSAGES): Set<string> {
  const keywords = new Set<string>()
  let seen = 0
  for (let index = events.length - 1; index >= 0 && seen < scan; index--) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type !== 'user/message') continue
    if (event.data.source.kind !== 'user') continue
    seen += 1
    for (const token of tokenize(messageText(event.data.content))) keywords.add(token)
  }
  return keywords
}

/**
 * The final assistant reply's plain text for one completed turn, or
 * `undefined` when the turn streamed none.
 */
function finalAssistantText(events: readonly SessionEvent[], turn: number): string | undefined {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event === undefined) continue
    if (event.type !== 'assistant/message') continue
    if (event.data.turn === turn) return messageText(event.data.message.content)
  }
  return undefined
}

/**
 * The `agentMemory` service: extraction intake, persistence ownership, and the
 * prompt-time scorer behind the registered `agent:memory` section.
 */
export class AgentMemoryService extends Service {
  private readonly store: MemoryStore
  private readonly topK: number

  constructor(ctx: Context, store: MemoryStore, options: { topK?: number | undefined } = {}) {
    super(ctx, 'agentMemory')
    this.store = store
    this.topK = options.topK ?? 8
  }

  /**
   * Ingest one session event: human prompts feed the decision/preference
   * rules; a completed turn's final assistant reply feeds the fact rule.
   */
  async observe(session: Session, event: SessionEvent): Promise<void> {
    switch (event.type) {
      case 'user/message': {
        if (event.data.source.kind !== 'user') return
        const sessionId = String(session.id)
        for (const candidate of extractUserCandidates(messageText(event.data.content))) {
          await this.store.record(candidate, sessionId, event.time)
        }
        return
      }
      case 'turn/end': {
        if (event.data.reason.kind !== 'completed') return
        const final = finalAssistantText(session.events, event.data.turn)
        if (final === undefined) return
        const candidate = extractAssistantCandidate(final)
        if (candidate === undefined) return
        await this.store.record(candidate, String(session.id), event.time)
        return
      }
      default:
        return
    }
  }

  /**
   * Render the `agent:memory` section text for one prompt assembly: Top-K
   * keyword-overlap entries against the assembling agent's current task.
   * Returns `''` when no agent is attached or nothing overlaps.
   */
  renderSection(assemble: AssembleContext): string {
    const agent: Agent | undefined = assemble.agent
    if (agent === undefined) return ''
    const selected = selectTopK(this.store.cachedEntries(), taskKeywords(agent.session.events), this.topK)
    return renderMemorySection(selected)
  }

  /** Every stored entry, oldest first (future UI/Remote read face). */
  list(): Promise<MemoryEntry[]> {
    return this.store.list()
  }

  /**
   * Drop one stored entry by id.
   * @returns whether the id existed.
   */
  forget(id: string): Promise<boolean> {
    return this.store.forget(id)
  }

  /** Eagerly load persisted shards so prompt-time scoring sees them before the first turn. */
  start(): Promise<void> {
    return this.store.load()
  }

  /** Await pending persistence (disposal seam). */
  drain(): Promise<void> {
    return this.store.drain()
  }
}

/**
 * Mount the memory plugin: construct and provide the `agentMemory` service,
 * watch session events for extraction candidates, register the `agent:memory`
 * prompt section, and arm lifecycle cleanup through `ctx.effect`.
 * @param ctx - plugin context.
 * @param config - validated {@link Config}.
 */
export function apply(ctx: Context, config: Config): void {
  const store = new MemoryStore(resolveMemoryRoot(config.storageRoot), { capacity: config.capacity })
  const service = new AgentMemoryService(ctx, store, { topK: config.topK })
  void service.start().catch(() => {})

  ctx.effect(() => async () => {
    // Pending extraction writes finish before the fiber tears down.
    await store.drain()
  }, 'agentMemory lifecycle')

  ctx.on('session/event', (session: Session, event: SessionEvent) => {
    void service.observe(session, event).catch(() => {})
  })

  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: MEMORY_SECTION_NAME,
      order: MEMORY_SECTION_ORDER,
      text: assembleContext => service.renderSection(assembleContext),
    })
  })
}
