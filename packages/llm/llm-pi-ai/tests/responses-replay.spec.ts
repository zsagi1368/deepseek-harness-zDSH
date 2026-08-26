import { afterEach, describe, expect, it } from 'vitest'
import { BlockAssembler, CallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter } from '../src/adapter.ts'
import type { PiAiProviderProfile } from '../src/config.ts'
import { resolveProfiles } from '../src/config.ts'
import { memoryAuth } from './auth-double.ts'
import { closeMockServers, mockServer } from './mock-server.ts'

/**
 * Wire-level regression for #231: an openai-responses custom gateway that does
 * not persist reasoning server-side rejects a multi-turn request whose history
 * lost the reasoning items ("reasoning_text must be passed back"). These specs
 * replay the gateway's SSE shape through the real adapter and assert the
 * follow-up request body carries the round-one reasoning item verbatim.
 */

/** Round 1: reasoning item followed by an assistant message, the reporter's capture shape. */
const RESPONSES_ROUND1 = [
  JSON.stringify({ type: 'response.created', response: { id: 'resp_1' } }),
  JSON.stringify({ type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: 'rs_1', summary: [] } }),
  JSON.stringify({ type: 'response.reasoning_text.delta', output_index: 0, delta: 'thinking hard' }),
  JSON.stringify({
    type: 'response.output_item.done',
    output_index: 0,
    item: {
      type: 'reasoning',
      id: 'rs_1',
      summary: [],
      content: [{ type: 'reasoning_text', text: 'thinking hard' }],
    },
  }),
  JSON.stringify({ type: 'response.output_item.added', output_index: 1, item: { type: 'message', id: 'msg_1', role: 'assistant' } }),
  JSON.stringify({ type: 'response.output_text.delta', output_index: 1, delta: 'hello' }),
  JSON.stringify({
    type: 'response.output_item.done',
    output_index: 1,
    item: { type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] },
  }),
  JSON.stringify({
    type: 'response.completed',
    response: { id: 'resp_1', status: 'completed', usage: { input_tokens: 5, output_tokens: 4, total_tokens: 9 } },
  }),
]

const RESPONSES_ROUND2 = [
  JSON.stringify({ type: 'response.created', response: { id: 'resp_2' } }),
  JSON.stringify({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: 'msg_2', role: 'assistant' } }),
  JSON.stringify({ type: 'response.output_text.delta', output_index: 0, delta: 'again' }),
  JSON.stringify({
    type: 'response.output_item.done',
    output_index: 0,
    item: { type: 'message', id: 'msg_2', role: 'assistant', content: [{ type: 'output_text', text: 'again' }] },
  }),
  JSON.stringify({
    type: 'response.completed',
    response: { id: 'resp_2', status: 'completed', usage: { input_tokens: 6, output_tokens: 2, total_tokens: 8 } },
  }),
]

/** Round 1 with a tool call after the reasoning item: the failing report's multi-turn agent shape. */
const RESPONSES_TOOLCALL_ROUND1 = [
  JSON.stringify({ type: 'response.created', response: { id: 'resp_t1' } }),
  JSON.stringify({ type: 'response.output_item.added', output_index: 0, item: { type: 'reasoning', id: 'rs_t1', summary: [] } }),
  JSON.stringify({ type: 'response.reasoning_text.delta', output_index: 0, delta: 'need a tool' }),
  JSON.stringify({
    type: 'response.output_item.done',
    output_index: 0,
    item: {
      type: 'reasoning',
      id: 'rs_t1',
      summary: [],
      content: [{ type: 'reasoning_text', text: 'need a tool' }],
    },
  }),
  JSON.stringify({ type: 'response.output_item.added', output_index: 1, item: { type: 'function_call', id: 'fc_t1', call_id: 'call_t1', name: 'lookup', arguments: '' } }),
  JSON.stringify({ type: 'response.function_call_arguments.delta', output_index: 1, delta: '{"q":"x"}' }),
  JSON.stringify({
    type: 'response.output_item.done',
    output_index: 1,
    item: { type: 'function_call', id: 'fc_t1', call_id: 'call_t1', name: 'lookup', arguments: '{"q":"x"}' },
  }),
  JSON.stringify({
    type: 'response.completed',
    response: { id: 'resp_t1', status: 'completed', usage: { input_tokens: 5, output_tokens: 4, total_tokens: 9 } },
  }),
]

/** A hand-declared model like the report's: no reasoning metadata, gateway thinks anyway. */
function gatewayProfile(baseURL: string): Record<string, PiAiProviderProfile> {
  return {
    gateway: {
      apiKeyEnv: 'PI_TEST_KEY',
      baseURL,
      api: 'openai-responses',
      models: [{ id: 'test-model', name: 'Test Model', contextWindow: 4096, maxTokens: 1024 }],
    },
  }
}

function gatewayAdapter(baseURL: string): PiAiAdapter {
  return new PiAiAdapter({
    profiles: () => resolveProfiles(gatewayProfile(baseURL)),
    resolveApiKey: () => Promise.resolve('test-key'),
    auth: memoryAuth(),
  })
}

async function streamOnce(
  adapter: PiAiAdapter,
  provider: string,
  model: string,
  messages: Message[],
): Promise<BlockAssembler> {
  const assembler = new BlockAssembler()
  const request: GenerateOptions = { provider, model, messages }
  for await (const chunk of adapter.stream(request)) assembler.push(chunk)
  return assembler
}

/** The durable assistant message the agent loop would persist between turns. */
function durableAssistant(assembler: BlockAssembler): Message {
  return assembler.message({
    kind: 'model',
    provider: 'gateway',
    model: 'test-model',
    ...assembler.replayState === undefined ? {} : { replayState: assembler.replayState },
  })
}

afterEach(async () => {
  await closeMockServers()
})

describe('openai-responses multi-turn reasoning pass-back (#231)', () => {
  it('carries the round-one reasoning item in the round-two request body', async () => {
    const server = await mockServer([{ events: RESPONSES_ROUND1 }, { events: RESPONSES_ROUND2 }])
    const adapter = gatewayAdapter(server.url)

    const user = createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'plugin', plugin: 'test' } })
    const first = await streamOnce(adapter, 'gateway', 'test-model', [user])
    expect(first.finish).toEqual({ kind: 'stop' })
    expect(first.message().content).toEqual([
      { type: 'reasoning', text: 'thinking hard' },
      { type: 'text', text: 'hello' },
    ])

    const followUp = createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'plugin', plugin: 'test' } })
    const second = await streamOnce(adapter, 'gateway', 'test-model', [user, durableAssistant(first), followUp])
    expect(second.finish).toEqual({ kind: 'stop' })

    const input = (server.requests[1] as { input?: Array<Record<string, unknown>> }).input ?? []
    // The exact reasoning item the gateway emitted comes back, positioned
    // before the assistant message item it belongs to.
    expect(input).toContainEqual({
      type: 'reasoning',
      id: 'rs_1',
      summary: [],
      content: [{ type: 'reasoning_text', text: 'thinking hard' }],
    })
    // user turn → reasoning item → assistant message → user turn; the reasoning
    // item precedes the assistant message it belongs to.
    expect(input.map(item => item['type'])).toEqual([undefined, 'reasoning', 'message', undefined])
    // The reasoning text rides only the reasoning item, never the visible
    // assistant message — CoT is not re-sent (re-priced) as plain text.
    const assistantItem = input.find(item => item['type'] === 'message') as { content?: Array<{ text?: string }> }
    expect(assistantItem?.content).toEqual([{ type: 'output_text', text: 'hello', annotations: [] }])
  })

  it('carries the reasoning item back across a tool-call turn', async () => {
    const server = await mockServer([{ events: RESPONSES_TOOLCALL_ROUND1 }, { events: RESPONSES_ROUND2 }])
    const adapter = gatewayAdapter(server.url)

    const user = createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'plugin', plugin: 'test' } })
    const first = await streamOnce(adapter, 'gateway', 'test-model', [user])
    expect(first.finish).toEqual({ kind: 'tool-calls' })

    const toolResult = createUserMessage({
      content: [{ type: 'tool-result', toolCallId: CallId('call_t1'), content: [{ type: 'text', text: 'result' }] }],
      source: { kind: 'plugin', plugin: 'test' },
    })
    const second = await streamOnce(adapter, 'gateway', 'test-model', [user, durableAssistant(first), toolResult])
    expect(second.finish).toEqual({ kind: 'stop' })

    const types = ((server.requests[1] as { input?: Array<{ type?: string }> }).input ?? []).map(item => item.type)
    expect(types).toContain('reasoning')
    expect(types).toContain('function_call')
    expect(types).toContain('function_call_output')
  })

  it('keeps reasoning-free turns byte-shaped as before: no reasoning item on the follow-up request', async () => {
    // A gateway/model pairing that never streams reasoning items must see
    // exactly the same multi-turn bodies it always did.
    const textOnly = RESPONSES_ROUND1.filter(event => !(event.includes('"reasoning_text.delta"') || event.includes('"type":"reasoning"')))
    const server = await mockServer([{ events: textOnly }, { events: RESPONSES_ROUND2 }])
    const adapter = gatewayAdapter(server.url)

    const user = createUserMessage({ content: [{ type: 'text', text: 'hi' }], source: { kind: 'plugin', plugin: 'test' } })
    const first = await streamOnce(adapter, 'gateway', 'test-model', [user])
    expect(first.message().content).toEqual([{ type: 'text', text: 'hello' }])

    const followUp = createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'plugin', plugin: 'test' } })
    await streamOnce(adapter, 'gateway', 'test-model', [user, durableAssistant(first), followUp])

    const types = ((server.requests[1] as { input?: Array<{ type?: string }> }).input ?? []).map(item => item.type)
    expect(types).not.toContain('reasoning')
    expect(types).toEqual([undefined, 'message', undefined])
  })
})
