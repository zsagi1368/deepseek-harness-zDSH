/**
 * Streaming repetition-loop detection for provider text streams.
 *
 * Long generations occasionally collapse into a degenerate loop: the model
 * re-emits the same short fragment (or floods one character) indefinitely,
 * burning tokens and minutes while producing garbage. This module implements
 * two conservative streaming heuristics over the visible text of each block:
 *
 * 1. Char-collapse: one non-whitespace character dominates the trailing
 *    window almost completely.
 * 2. N-gram loop: a unit whose MINIMAL period is `loopMinUnitChars`..
 *    `loopMaxUnitChars` code units repeats verbatim and consecutively at
 *    least `loopMinRepeats` times and covers at least
 *    `loopMinCoverageRatio` of the trailing window. The minimality check
 *    keeps short-period structured content (hex dumps, tables, CSV rows)
 *    out of scope even though its multi-line stretches also match larger
 *    candidate periods.
 *
 * The detector never retries, never rewrites content, and only reports; the
 * runtime turns a finding into a terminal `error` finish carrying the
 * {@link REPETITION_LOOP_CODE}-coded failure so callers can distinguish a
 * suspected model repetition loop from transport failures. Thresholds are
 * configuration; the defaults are deliberately conservative so ordinary long
 * answers (repeated code structures, tables, dividers) pass untouched.
 *
 * @module @deepseek-ai/dsh-llm/repetition-guard
 */

import z from '@deepseek-ai/schemastery'
import type { StreamChunk } from './types.ts'

/** Tunable repetition-loop detection thresholds; every field is optional. */
export interface RepetitionGuardConfig {
  /** Master switch for stream monitoring (default `true`). */
  enabled?: boolean
  /**
   * Trailing analysis window in UTF-16 code units per monitored block.
   * Findings require at least this much observed text (default 2048), so
   * short answers are structurally out of reach.
   */
  minWindowChars?: number
  /** Minimum appended characters between scans of one block (default 256). */
  checkIntervalChars?: number
  /**
   * Window share above which a single non-whitespace character is a collapse
   * (default 0.92). Whitespace-dominant windows never fire: indentation and
   * blank-line formatting are legitimate.
   */
  charCollapseRatio?: number
  /** Shortest verbatim repeat unit still treated as a loop (default 32). */
  loopMinUnitChars?: number
  /** Longest verbatim repeat unit considered (default 256). */
  loopMaxUnitChars?: number
  /** Consecutive verbatim repeats of one unit required to fire (default 25). */
  loopMinRepeats?: number
  /**
   * Fraction of the analysis window the looping span must already cover
   * before firing (default 0.5), keeping brief repetitions at the tail of an
   * otherwise normal answer below the threshold.
   */
  loopMinCoverageRatio?: number
}

/** Validated, immutable repetition-guard settings captured by the runtime. */
export interface ResolvedRepetitionGuardSettings {
  readonly enabled: boolean
  readonly minWindowChars: number
  readonly checkIntervalChars: number
  readonly charCollapseRatio: number
  readonly loopMinUnitChars: number
  readonly loopMaxUnitChars: number
  readonly loopMinRepeats: number
  readonly loopMinCoverageRatio: number
}

const DEFAULT_ENABLED = true
const DEFAULT_MIN_WINDOW_CHARS = 2048
const DEFAULT_CHECK_INTERVAL_CHARS = 256
const DEFAULT_CHAR_COLLAPSE_RATIO = 0.92
const DEFAULT_LOOP_MIN_UNIT_CHARS = 32
const DEFAULT_LOOP_MAX_UNIT_CHARS = 256
const DEFAULT_LOOP_MIN_REPEATS = 25
const DEFAULT_LOOP_MIN_COVERAGE_RATIO = 0.5

/** Conservative factory defaults, exported for tests and documentation surfaces. */
export const DEFAULT_REPETITION_GUARD_SETTINGS: ResolvedRepetitionGuardSettings = Object.freeze({
  enabled: DEFAULT_ENABLED,
  minWindowChars: DEFAULT_MIN_WINDOW_CHARS,
  checkIntervalChars: DEFAULT_CHECK_INTERVAL_CHARS,
  charCollapseRatio: DEFAULT_CHAR_COLLAPSE_RATIO,
  loopMinUnitChars: DEFAULT_LOOP_MIN_UNIT_CHARS,
  loopMaxUnitChars: DEFAULT_LOOP_MAX_UNIT_CHARS,
  loopMinRepeats: DEFAULT_LOOP_MIN_REPEATS,
  loopMinCoverageRatio: DEFAULT_LOOP_MIN_COVERAGE_RATIO,
})

/** Cordis schema for the optional `repetitionGuard` section of the llm plugin config. */
export const RepetitionGuardSchema: z<RepetitionGuardConfig> = z.object({
  enabled: z.boolean(),
  minWindowChars: z.number().step(1),
  checkIntervalChars: z.number().step(1),
  charCollapseRatio: z.number(),
  loopMinUnitChars: z.number().step(1),
  loopMaxUnitChars: z.number().step(1),
  loopMinRepeats: z.number().step(1),
  loopMinCoverageRatio: z.number(),
})

const CONFIG_KEYS: ReadonlySet<string> = new Set([
  'enabled',
  'minWindowChars',
  'checkIntervalChars',
  'charCollapseRatio',
  'loopMinUnitChars',
  'loopMaxUnitChars',
  'loopMinRepeats',
  'loopMinCoverageRatio',
])

function requireInteger(value: number, label: string, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`repetition-guard: ${label} must be a safe integer from ${min} through ${max}`)
  }
}

function requireRatio(value: number, label: string): void {
  if (!Number.isFinite(value) || value <= 0 || value > 1) {
    throw new Error(`repetition-guard: ${label} must be a finite number greater than 0 and no greater than 1`)
  }
}

/**
 * Validate, default, and detach one repetition-guard configuration.
 * @param config - optional user configuration; omission selects the
 *   conservative defaults.
 * @returns immutable settings safe to capture in service state.
 */
export function resolveRepetitionGuardConfig(
  config?: RepetitionGuardConfig,
): ResolvedRepetitionGuardSettings {
  if (config === undefined) return DEFAULT_REPETITION_GUARD_SETTINGS
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new Error(`repetition-guard: unknown key "${key}"`)
  }
  if (config.enabled === false) {
    // A disabled guard skips every threshold check; still validate nothing else
    // was misspelled, which the key check above already covered.
    return Object.freeze({ ...DEFAULT_REPETITION_GUARD_SETTINGS, enabled: false })
  }
  const minWindowChars = config.minWindowChars ?? DEFAULT_MIN_WINDOW_CHARS
  const checkIntervalChars = config.checkIntervalChars ?? DEFAULT_CHECK_INTERVAL_CHARS
  const charCollapseRatio = config.charCollapseRatio ?? DEFAULT_CHAR_COLLAPSE_RATIO
  const loopMinUnitChars = config.loopMinUnitChars ?? DEFAULT_LOOP_MIN_UNIT_CHARS
  const loopMaxUnitChars = config.loopMaxUnitChars ?? DEFAULT_LOOP_MAX_UNIT_CHARS
  const loopMinRepeats = config.loopMinRepeats ?? DEFAULT_LOOP_MIN_REPEATS
  const loopMinCoverageRatio = config.loopMinCoverageRatio ?? DEFAULT_LOOP_MIN_COVERAGE_RATIO

  requireInteger(minWindowChars, 'minWindowChars', 64, 1_048_576)
  requireInteger(checkIntervalChars, 'checkIntervalChars', 16, minWindowChars)
  requireRatio(charCollapseRatio, 'charCollapseRatio')
  requireInteger(loopMinUnitChars, 'loopMinUnitChars', 2, 4096)
  requireInteger(loopMaxUnitChars, 'loopMaxUnitChars', loopMinUnitChars, 65_536)
  requireInteger(loopMinRepeats, 'loopMinRepeats', 2, 1_048_576)
  requireRatio(loopMinCoverageRatio, 'loopMinCoverageRatio')
  return Object.freeze({
    enabled: true,
    minWindowChars,
    checkIntervalChars,
    charCollapseRatio,
    loopMinUnitChars,
    loopMaxUnitChars,
    loopMinRepeats,
    loopMinCoverageRatio,
  })
}

/**
 * One detector finding: which heuristic fired, on which block, with bounded
 * excerpts preserved for diagnostics and upstream feedback.
 */
export interface RepetitionLoopFinding {
  /** Heuristic that fired. */
  kind: 'char-collapse' | 'ngram-loop'
  /** Kind of the watched content block (`text` or `reasoning`). */
  blockKind: 'text' | 'reasoning'
  /** Stream block index the watched content belongs to. */
  index: number
  /** Total characters streamed into the block before the trip. */
  totalChars: number
  /** Collapse findings: the dominant non-whitespace character. */
  dominantChar?: string
  /** Collapse findings: the dominant character's share of the window. */
  dominantRatio?: number
  /** Loop findings: the verbatim unit length in UTF-16 code units. */
  unitChars?: number
  /** Loop findings: characters covered by the confirmed periodic span. */
  spanChars?: number
  /** Loop findings: complete verbatim repeats inside the span. */
  repeats?: number
  /** Bounded head excerpt of the watched block (whitespace-collapsed). */
  headSample: string
  /** Bounded excerpt of the repeating content itself. */
  loopSample: string
}

/** Bounded excerpt lengths for diagnostic samples. */
const HEAD_SAMPLE_CHARS = 160
const LOOP_SAMPLE_MAX_CHARS = 256

/**
 * Render one excerpt safe for single-line messages: control characters and
 * whitespace runs collapse, and the result truncates to `max` code units.
 * Model output carries no credentials, but logs and notices stay readable
 * only if hostile control sequences cannot survive into them.
 * @param text - raw streamed text.
 * @param max - maximum returned length in UTF-16 code units.
 * @returns the sanitized, truncated excerpt.
 */
function sanitizeExcerpt(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '')
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max)}…`
}

/**
 * Per-block sliding-window scanner. Holds at most `minWindowChars` trailing
 * characters plus per-character counts, and scans at most once per
 * `checkIntervalChars` appended characters.
 */
class BlockScanner {
  private buffer = ''
  private readonly counts = new Map<string, number>()
  private sinceCheck = 0
  private total = 0
  private head = ''

  constructor(private readonly settings: ResolvedRepetitionGuardSettings) {}

  /**
   * Append one delta to the window, maintaining counts and the bounded head.
   * @param text - the streamed delta text.
   */
  push(text: string): void {
    if (this.head.length < HEAD_SAMPLE_CHARS) {
      this.head += text.slice(0, HEAD_SAMPLE_CHARS - this.head.length)
    }
    this.total += text.length
    this.sinceCheck += text.length
    this.buffer += text
    for (const ch of text) {
      this.counts.set(ch, (this.counts.get(ch) ?? 0) + 1)
    }
    this.trim()
  }

  /**
   * Whether enough characters accumulated since the last scan to justify another.
   * @returns true when a scan is due.
   */
  get checkDue(): boolean {
    return this.sinceCheck >= this.settings.checkIntervalChars
  }

  /** Drop whole code points from the front until the window bound holds. */
  private trim(): void {
    const limit = this.buffer.length - this.settings.minWindowChars
    if (limit <= 0) return
    let cursor = 0
    while (cursor < limit) {
      const codePoint = this.buffer.codePointAt(cursor)
      if (codePoint === undefined) break
      const ch = String.fromCodePoint(codePoint)
      const remaining = (this.counts.get(ch) ?? 0) - 1
      if (remaining <= 0) this.counts.delete(ch)
      else this.counts.set(ch, remaining)
      cursor += codePoint > 0xffff ? 2 : 1
    }
    this.buffer = this.buffer.slice(cursor)
  }

  /**
   * Run both heuristics over the current window.
   * @returns raw finding facts, or `undefined` when neither heuristic fires.
   */
  scan(): Omit<RepetitionLoopFinding, 'blockKind' | 'index' | 'totalChars' | 'headSample'> | undefined {
    this.sinceCheck = 0
    if (this.buffer.length < this.settings.minWindowChars) return undefined
    return this.scanCollapse() ?? this.scanPeriodic()
  }

  /** Heuristic 1: one non-whitespace character dominating the whole window. */
  private scanCollapse():
    | Omit<RepetitionLoopFinding, 'blockKind' | 'index' | 'totalChars' | 'headSample'>
    | undefined {
    let bestChar: string | undefined
    let bestCount = 0
    for (const [ch, count] of this.counts) {
      if (count > bestCount && !/\s/u.test(ch)) {
        bestCount = count
        bestChar = ch
      }
    }
    if (bestChar === undefined) return undefined
    const ratio = bestCount / this.buffer.length
    if (ratio < this.settings.charCollapseRatio) return undefined
    return {
      kind: 'char-collapse',
      dominantChar: bestChar,
      dominantRatio: ratio,
      loopSample: sanitizeExcerpt(this.buffer.slice(-LOOP_SAMPLE_MAX_CHARS), LOOP_SAMPLE_MAX_CHARS),
    }
  }

  /**
   * Length of the trailing span that holds with period `gap`: every position
   * equals the one `gap` code units earlier.
   */
  private matchLength(gap: number): number {
    const text = this.buffer
    const size = text.length
    let matched = 0
    while (matched < size - gap
      && text.charCodeAt(size - 1 - matched) === text.charCodeAt(size - 1 - matched - gap)) {
      matched += 1
    }
    return matched
  }

  /**
   * Smallest period that explains the confirmed trailing span. Structured
   * content (hex dumps, tables, CSV rows) repeats with SHORT units whose
   * multiples also match; without this reduction the scanner would misread a
   * legitimate tabular stretch as a long-unit loop.
   * @param span - the confirmed periodic trailing span length.
   * @param candidate - the candidate period the scan fired on.
   * @returns the smallest period covering at least `span` of the tail;
   *   `candidate` itself when no smaller period explains it.
   */
  private smallestExplainingPeriod(span: number, candidate: number): number {
    for (let gap = 1; gap < candidate; gap += 1) {
      if (this.matchLength(gap) >= span) return gap
    }
    return candidate
  }

  /** Heuristic 2: a verbatim unit repeating consecutively across most of the window. */
  private scanPeriodic():
    | Omit<RepetitionLoopFinding, 'blockKind' | 'index' | 'totalChars' | 'headSample'>
    | undefined {
    const size = this.buffer.length
    const requiredSpan = Math.ceil(this.settings.loopMinCoverageRatio * size)
    for (
      let period = this.settings.loopMinUnitChars;
      period <= this.settings.loopMaxUnitChars;
      period += 1
    ) {
      // Not enough room left for the required repeat count within the window.
      if (period * this.settings.loopMinRepeats > size) continue
      const matched = this.matchLength(period)
      const repeats = Math.floor(matched / period)
      if (repeats < this.settings.loopMinRepeats || matched < requiredSpan) continue
      const smallest = this.smallestExplainingPeriod(matched, period)
      if (smallest < this.settings.loopMinUnitChars) continue
      return {
        kind: 'ngram-loop',
        unitChars: smallest,
        spanChars: matched,
        repeats: Math.floor(matched / smallest),
        loopSample: sanitizeExcerpt(this.buffer.slice(size - smallest), LOOP_SAMPLE_MAX_CHARS),
      }
    }
    return undefined
  }

  /** Raw head excerpt of the watched block. */
  get headSample(): string {
    return this.head
  }

  /** Total characters streamed into the watched block. */
  get totalChars(): number {
    return this.total
  }
}

/**
 * Per-stream repetition monitor. Feed every chunk of one model stream through
 * {@link observe}; the call returns a finding exactly once, at the moment a
 * heuristic trips, after which the runtime stops consuming the stream.
 */
export class StreamRepetitionMonitor {
  private readonly scanners = new Map<number, BlockScanner>()

  constructor(private readonly settings: ResolvedRepetitionGuardSettings) {}

  /**
   * Feed one stream chunk into the monitor.
   * @param chunk - the next raw stream chunk, in stream order.
   * @returns the trip finding, or `undefined` while no heuristic has fired.
   */
  observe(chunk: StreamChunk): RepetitionLoopFinding | undefined {
    switch (chunk.type) {
      case 'text-delta':
      case 'reasoning-delta': {
        const blockKind = chunk.type === 'text-delta' ? 'text' : 'reasoning'
        let scanner = this.scanners.get(chunk.index)
        if (scanner === undefined) {
          // Delta-only protocols skip block-start; create the watcher lazily.
          // Tool-call blocks never reach here because their delta type differs.
          scanner = new BlockScanner(this.settings)
          this.scanners.set(chunk.index, scanner)
        }
        scanner.push(chunk.text)
        if (!scanner.checkDue) return undefined
        const facts = scanner.scan()
        if (facts === undefined) return undefined
        this.scanners.delete(chunk.index)
        return {
          ...facts,
          blockKind,
          index: chunk.index,
          totalChars: scanner.totalChars,
          headSample: sanitizeExcerpt(scanner.headSample, HEAD_SAMPLE_CHARS),
        }
      }
      case 'block-end': {
        this.scanners.delete(chunk.index)
        return undefined
      }
      default:
        return undefined
    }
  }
}

/** Route facts stamped into the human-readable failure message. */
export interface RepetitionRouteFacts {
  /** Provider route the looping stream belongs to. */
  provider: string
  /** Exact model id the looping stream belongs to. */
  model: string
}

/**
 * Render the terminal failure message for one finding. The wording names the
 * suspected repetition loop explicitly so users and support channels can tell
 * it apart from transport errors, embeds bounded sanitized samples for
 * upstream feedback, and points at the tuning surface.
 * @param finding - the detector finding that tripped the stream.
 * @param route - provider/model attribution for the failing stream.
 * @returns the human-readable failure message.
 */
export function renderRepetitionLoopMessage(finding: RepetitionLoopFinding, route: RepetitionRouteFacts): string {
  const detail = finding.kind === 'char-collapse'
    ? `one character dominated ${Math.round((finding.dominantRatio ?? 0) * 100)}% of the recent `
      + `${finding.totalChars}-character output`
    : `a ${finding.unitChars}-character unit repeated ${finding.repeats} times in a row `
      + `(${finding.spanChars} characters covered)`
  // Re-sanitize here even though the monitor already did: the finding type is
  // a plain interface, so every message path stays safe by construction.
  return `suspected model repetition loop (not a network or transport error): provider "${route.provider}" `
    + `model "${route.model}" ${finding.blockKind} block #${finding.index} stalled — ${detail}; `
    + `repeating sample: "${sanitizeExcerpt(finding.loopSample, LOOP_SAMPLE_MAX_CHARS)}"; `
    + `answer start: "${sanitizeExcerpt(finding.headSample, HEAD_SAMPLE_CHARS)}"; `
    + 'tune or disable via the llm plugin "repetitionGuard" setting'
}
