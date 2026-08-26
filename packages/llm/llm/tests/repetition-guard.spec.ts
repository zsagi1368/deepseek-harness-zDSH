/**
 * Repetition-loop guard: threshold resolution, streaming heuristics, an
 * adversarial corpus (degenerate loops must trip; legitimate repetitive
 * long-form answers must not), and runtime stream integration (S-16).
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, {
  CallId,
  DEFAULT_REPETITION_GUARD_SETTINGS,
  GenerateOptions,
  LlmAdapter,
  REPETITION_LOOP_CODE,
  resolveRepetitionGuardConfig,
  resolveRetryPolicy,
  StreamChunk,
  StreamRepetitionMonitor,
  renderRepetitionLoopMessage,
} from '@deepseek-ai/dsh-llm'
import type { RepetitionGuardConfig, RepetitionLoopFinding } from '@deepseek-ai/dsh-llm'

/** Feed `text` through the monitor in exactly one check-interval sized deltas. */
function feed(monitor: StreamRepetitionMonitor, text: string, index = 0): RepetitionLoopFinding | undefined {
  const chunkSize = DEFAULT_REPETITION_GUARD_SETTINGS.checkIntervalChars
  for (let offset = 0; offset < text.length; offset += chunkSize) {
    const finding = monitor.observe({ type: 'text-delta', index, text: text.slice(offset, offset + chunkSize) })
    if (finding !== undefined) return finding
  }
  return undefined
}

/** Build a deterministic pseudo-random ASCII string of the given length. */
function pseudoRandomAscii(length: number, seed: number): string {
  let state = seed
  let out = ''
  while (out.length < length) {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648
    out += String.fromCharCode(33 + (state % 90))
  }
  return out.slice(0, length)
}

describe('repetition guard configuration', () => {
  it('selects conservative defaults when unconfigured', () => {
    expect(resolveRepetitionGuardConfig(undefined)).toEqual(DEFAULT_REPETITION_GUARD_SETTINGS)
  })

  it('merges partial overrides over the defaults', () => {
    const resolved = resolveRepetitionGuardConfig({ loopMinRepeats: 40 })
    expect(resolved.enabled).toBe(true)
    expect(resolved.loopMinRepeats).toBe(40)
    expect(resolved.minWindowChars).toBe(DEFAULT_REPETITION_GUARD_SETTINGS.minWindowChars)
  })

  it('keeps every default when disabled without validating thresholds', () => {
    const resolved = resolveRepetitionGuardConfig({ enabled: false })
    expect(resolved).toEqual({ ...DEFAULT_REPETITION_GUARD_SETTINGS, enabled: false })
  })

  it('rejects unknown keys and out-of-range values', () => {
    expect(() => resolveRepetitionGuardConfig({ nope: true } as unknown as RepetitionGuardConfig)).toThrow('unknown key "nope"')
    expect(() => resolveRepetitionGuardConfig({ minWindowChars: 0 })).toThrow('minWindowChars')
    expect(() => resolveRepetitionGuardConfig({ charCollapseRatio: 1.5 })).toThrow('charCollapseRatio')
    expect(() => resolveRepetitionGuardConfig({ charCollapseRatio: 0 })).toThrow('charCollapseRatio')
    expect(() => resolveRepetitionGuardConfig({
      loopMinUnitChars: 128,
      loopMaxUnitChars: 64,
    })).toThrow('loopMaxUnitChars')
  })

  it('leaves REPETITION_LOOP outside the default retryable set so loops are never retried silently', () => {
    const policy = resolveRetryPolicy(undefined, 'test')
    expect(policy.mode !== 'normal' || !policy.retryableCodes.includes(REPETITION_LOOP_CODE)).toBe(true)
  })
})

describe('streaming repetition heuristics', () => {
  it('ignores short answers entirely (below the arming window)', () => {
    const monitor = new StreamRepetitionMonitor(resolveRepetitionGuardConfig())
    expect(feed(monitor, '啊'.repeat(1000))).toBeUndefined()
  })

  it('watches blocks independently per index', () => {
    const monitor = new StreamRepetitionMonitor(resolveRepetitionGuardConfig())
    // Genuinely varied filler: every line names a different aspect.
    const varied = Array.from(
      { length: 90 },
      (_, i) => `Point ${i}: this explains aspect ${i % 7} with enough other words to vary the stream. `,
    ).join('')
    expect(feed(monitor, varied, 1)).toBeUndefined()
    const finding = feed(monitor, 'the quick brown fox jumps over the lazy dog. '.repeat(50), 0)
    expect(finding?.kind).toBe('ngram-loop')
    expect(finding?.index).toBe(0)
  })

  it('discards a block scanner at block-end instead of carrying state across blocks', () => {
    const monitor = new StreamRepetitionMonitor(resolveRepetitionGuardConfig())
    expect(feed(monitor, '啊'.repeat(2400), 3)).toBeDefined()
    monitor.observe({ type: 'block-end', index: 3, block: { type: 'text', text: '' } })
    // The recreated watcher starts from an empty window again, so a fresh
    // stream shorter than the arming window cannot trip on carried-over state.
    expect(feed(monitor, '啊'.repeat(DEFAULT_REPETITION_GUARD_SETTINGS.minWindowChars - 256), 3)).toBeUndefined()
  })
})

describe('adversarial corpus: degenerate loops must trip', () => {
  const cases: Array<{ name: string; text: string }> = [
    { name: 'P1 single CJK character flood', text: '啊'.repeat(2400) },
    { name: 'P2 punctuation flood', text: '!'.repeat(2400) },
    { name: 'P3 mixed-script garbage loop (~48-char unit)', text: pseudoRandomAscii(48, 7).repeat(44) },
    { name: 'P4 English phrase loop', text: 'the quick brown fox jumps over the lazy dog. '.repeat(46) },
    { name: 'P5 code-token loop', text: 'for(let i=0;i<n;i++){console.log(i)} '.repeat(60) },
    {
      name: 'P6 late-start loop after a long normal answer',
      text: 'Here is a thorough explanation of the topic with varied sentences. '.repeat(38)
        + 'error code 0xdeadbeef please retry operation failed error code 0xdeadbeef '.repeat(40),
    },
  ]

  for (const item of cases) {
    it(`trips on ${item.name}`, () => {
      const monitor = new StreamRepetitionMonitor(resolveRepetitionGuardConfig())
      const finding = feed(monitor, item.text)
      expect(finding, `${item.name} should trip`).toBeDefined()
      expect(finding?.headSample.length).toBeGreaterThan(0)
      expect(finding?.loopSample.length).toBeLessThanOrEqual(
        DEFAULT_REPETITION_GUARD_SETTINGS.loopMaxUnitChars + 8,
      )
    })
  }

  it('trips on reasoning-delta loops too', () => {
    const monitor = new StreamRepetitionMonitor(resolveRepetitionGuardConfig())
    const text = 'step three multiply by two then subtract one '.repeat(60)
    const size = DEFAULT_REPETITION_GUARD_SETTINGS.checkIntervalChars
    let finding: RepetitionLoopFinding | undefined
    for (let offset = 0; offset < text.length && finding === undefined; offset += size) {
      finding = monitor.observe({ type: 'reasoning-delta', index: 1, text: text.slice(offset, offset + size) })
    }
    expect(finding?.kind).toBe('ngram-loop')
    expect(finding?.blockKind).toBe('reasoning')
  })
})

describe('adversarial corpus: legitimate repetitive answers must pass', () => {
  const boilerplate = 'This agreement is governed by the laws of the applicable jurisdiction, '
    + 'and any dispute shall be resolved under those exclusive rules without waiver. '

  const cases: Array<{ name: string; text: string }> = [
    {
      name: 'N1 near-identical generated functions (names vary)',
      text: Array.from({ length: 20 }, (_, i) =>
        `function handler${i}(input) {\n  const result${i} = transform(input, ${i});\n`
        + `  return { ok: true, step: ${i}, value: result${i} };\n}\n\n`).join(''),
    },
    {
      name: 'N2 markdown table with varying rows',
      text: '| id | name | score |\n|---|---|---|\n'
        + Array.from({ length: 90 }, (_, i) => `| ${100 + i} | user-${i} | ${(i * 37) % 100}.5 |\n`).join(''),
    },
    {
      name: 'N3 hex dump with identical short-period lines',
      text: '00 00 00 00 00 00 00 00\n'.repeat(120),
    },
    { name: 'N4 high-entropy base64-style blob', text: pseudoRandomAscii(3000, 42) },
    {
      name: 'N5 poem refrain repeated three times',
      text: 'The sea, the sea, the open sea;\nThe blue, the fresh, the ever free!\n'
        + 'Without a wreck, without a foam.\n'.repeat(3),
    },
    {
      name: 'N6 varied Chinese essay',
      text: ('在软件工程实践中，可维护性往往比短期交付速度更重要。'
        + '团队应当建立清晰的边界、持续重构，并以测试作为设计的副产品。').repeat(15),
    },
    { name: 'N7 bullet list with identical short lines', text: '> note\n'.repeat(120) },
    { name: 'N8 CSV export with identical short rows', text: 'a,b,c\n'.repeat(400) },
    { name: 'N9 whitespace-heavy formatting', text: '     \n'.repeat(500) },
    {
      name: 'N10 URL list with incrementing page numbers',
      text: Array.from({ length: 80 }, (_, i) => `https://example.com/docs?page=${i}&sort=asc\n`).join(''),
    },
    { name: 'N11 legal boilerplate repeated twenty times (below the repeat gate)', text: boilerplate.repeat(20) },
    {
      name: 'N12 numbered build steps with varying counters',
      text: Array.from({ length: 120 }, (_, i) => `step ${i}: compiling module_${i} took ${i % 9}ms\n`).join(''),
    },
  ]

  for (const item of cases) {
    it(`passes ${item.name}`, () => {
      const monitor = new StreamRepetitionMonitor(resolveRepetitionGuardConfig())
      expect(feed(monitor, item.text), `${item.name} is a false positive`).toBeUndefined()
    })
  }
})

describe('runtime stream integration', () => {
  class ScriptedAdapter extends LlmAdapter {
    closed = false

    constructor(private readonly script: StreamChunk[]) {
      super()
    }

    override async * stream(_options: GenerateOptions): AsyncIterable<StreamChunk> {
      try {
        yield* this.script
      } finally {
        this.closed = true
      }
    }
  }

  /** A script whose text deltas flood one character past the arming window. */
  function loopingScript(): StreamChunk[] {
    const script: StreamChunk[] = [{ type: 'block-start', index: 0, blockType: 'text' }]
    for (let i = 0; i < 20; i += 1) {
      script.push({ type: 'text-delta', index: 0, text: '啊'.repeat(256) })
    }
    // Grammatical tail: a guard that never trips (or is disabled) must be able
    // to replay the whole script without violating the stream protocol.
    script.push({ type: 'block-end', index: 0, block: { type: 'text', text: '' } })
    script.push({ type: 'usage', usage: { inputTokens: 10, outputTokens: 900 } })
    script.push({ type: 'finish', reason: { kind: 'stop' } })
    return script
  }

  async function mount(config?: ConstructorParameters<typeof LlmRuntime>[1]): Promise<Context> {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime, config)
    return ctx
  }

  it('stops a looping stream with a coded terminal error finish and closes the adapter', async () => {
    const ctx = await mount()
    const adapter = new ScriptedAdapter(loopingScript())
    ctx.llm.registerAdapter(['test-provider'], adapter)

    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({ provider: 'test-provider', model: 'test-model', messages: [] })) {
      chunks.push(chunk)
    }

    const finish = chunks.at(-1)
    expect(finish?.type).toBe('finish')
    expect(finish?.type === 'finish' && finish.reason.kind).toBe('error')
    const failure = finish?.type === 'finish' && finish.reason.kind === 'error' ? finish.reason.failure : undefined
    expect(failure?.code).toBe(REPETITION_LOOP_CODE)
    expect(failure?.message).toContain('suspected model repetition loop (not a network or transport error)')
    // Seven deltas armed the window; the eighth (triggering) delta is withheld,
    // and nothing after it (usage, scripted stop finish) is ever consumed.
    expect(chunks.filter(chunk => chunk.type === 'text-delta')).toHaveLength(7)
    expect(adapter.closed).toBe(true)
  })

  it('passes a healthy stream through byte-for-byte', async () => {
    const ctx = await mount()
    const script: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'hello world' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'hello world' } },
      { type: 'usage', usage: { inputTokens: 1, outputTokens: 2 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const adapter = new ScriptedAdapter(script)
    ctx.llm.registerAdapter(['test-provider'], adapter)

    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({ provider: 'test-provider', model: 'test-model', messages: [] })) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual(script)
  })

  it('never scans tool-call arguments even when they repeat heavily', async () => {
    const ctx = await mount()
    const callId = CallId('call-1')
    const script: StreamChunk[] = [
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      { type: 'tool-call-delta', index: 0, id: callId, argumentsDelta: 'aaaaaaaa'.repeat(600) },
      { type: 'block-end', index: 0, block: { type: 'tool-call', id: callId, name: 'write', arguments: '{}' } },
      { type: 'finish', reason: { kind: 'stop' } },
    ]
    const adapter = new ScriptedAdapter(script)
    ctx.llm.registerAdapter(['test-provider'], adapter)

    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({ provider: 'test-provider', model: 'test-model', messages: [] })) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual(script)
  })

  it('lets a disabled guard pass a looping stream through untouched', async () => {
    const ctx = await mount({ repetitionGuard: { enabled: false } })
    const script = loopingScript()
    const adapter = new ScriptedAdapter(script)
    ctx.llm.registerAdapter(['test-provider'], adapter)

    const chunks: StreamChunk[] = []
    for await (const chunk of ctx.llm.stream({ provider: 'test-provider', model: 'test-model', messages: [] })) {
      chunks.push(chunk)
    }
    expect(chunks).toEqual(script)
  })

  it('validates guard configuration eagerly at construction', () => {
    expect(() => new LlmRuntime(new Context(), { repetitionGuard: { charCollapseRatio: 2 } }))
      .toThrow('charCollapseRatio')
    expect(() => new LlmRuntime(new Context(), { repetitionGuard: { mystery: 1 } as unknown as RepetitionGuardConfig }))
      .toThrow('unknown key "mystery"')
  })

  it('renders bounded, sanitized diagnostic samples in the failure message', () => {
    const finding: RepetitionLoopFinding = {
      kind: 'ngram-loop',
      blockKind: 'text',
      index: 0,
      totalChars: 2600,
      unitChars: 45,
      spanChars: 1890,
      repeats: 42,
      headSample: 'start of answer\twith tabs and\nnewlines '.repeat(10),
      loopSample: 'error code 0xdeadbeef retry '.repeat(20),
    }
    const message = renderRepetitionLoopMessage(finding, { provider: 'p', model: 'm' })
    expect(message).toContain('not a network or transport error')
    expect(message).toContain('provider "p"')
    expect(message).toContain('"repetitionGuard"')
    expect(message).not.toContain('\t')
    expect(message).not.toContain('\n')
    expect(message.length).toBeLessThan(1200)
  })
})
