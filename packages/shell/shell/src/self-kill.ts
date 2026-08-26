/**
 * Detection of shell commands that would terminate the harness host itself
 * (#387). An agent running inside `dsh web` shares the process it may want to
 * restart: `kill <host-pid>` through the shell tool ends the backend before
 * the tool call can return, and the session strands in "running" forever.
 * This predicate names termination commands aimed at THIS process or its
 * ancestor chain — by pid, or by process name for the name-based killers —
 * so the shell tools can refuse them before anything executes.
 *
 * Deliberately conservative, mirroring the recursive-delete precedent (#149):
 * only targets resolving to the host's own pid/name identity match. Killing
 * unrelated processes stays ungated. Known escapes, accepted because a hard
 * refusal must not misfire on ordinary administration: regex- or
 * substring-spelled kill patterns (only exact name equality fires), variable
 * pid references (`Stop-Process -Id $p`), stdin-fed pid pipelines
 * (`pgrep dsh | xargs kill` — the target never appears in the command),
 * enumeration chains interrupted by another cmdlet
 * (`Get-Process dsh | Sort-Object | Stop-Process`), and method-call shapes
 * (`$_.Kill()`). Embedded-verb false positives err the other way on purpose:
 * a refused `echo kill <own-pid>` costs one retry, a dead host costs the
 * session.
 * @module @deepseek-ai/dsh-shell/self-kill
 */

import { tokenizeCommandLine } from './command-tokenize.ts'
import type { ShellDialect } from './recursive-delete.ts'

/** One detector query: the command plus the identity facts of the process it must not kill. */
export interface SelfKillProbe {
  /** Shell dialect the command is written for. */
  readonly dialect: ShellDialect
  /** The raw command line exactly as the model wrote it. */
  readonly command: string
  /**
   * Pids whose termination ends this session: the harness host process and
   * its ancestor chain. {@link hostProcessChain} builds this from the live
   * process; a caller with deeper ancestry knowledge may extend the list.
   */
  readonly protectedPids: readonly number[]
  /**
   * Command-name candidates the harness host answers to, for the name-based
   * killers (`pkill`/`killall`/`Stop-Process -Name`/`taskkill /IM`).
   * {@link selfProcessNames} collects these from the live process.
   */
  readonly selfNames: readonly string[]
}

/**
 * How far {@link hostProcessChain} walks above the calling process. Deep
 * enough for launcher wrappers (npm/npx/shim chains); shallow enough that a
 * corrupted parent chain cannot spin the walk.
 */
const MAX_ANCESTOR_DEPTH = 8

/**
 * Pids whose death ends this session: the running harness process followed by
 * as much of its ancestor chain as Node exposes natively (`process.ppid`
 * reaches exactly one hop — deeper hops would need per-platform process
 * queries, so the walk stops there today while staying capped and
 * cycle-safe for a future resolver upgrade).
 * @param maxDepth - upper bound on returned chain length (default {@link MAX_ANCESTOR_DEPTH}).
 * @param parentOf - one-hop parent resolver; tests inject fakes to pin the cap and cycle guard.
 * @returns the protected pids, self first, deduplicated, in ancestry order.
 */
export function hostProcessChain(
  maxDepth: number = MAX_ANCESTOR_DEPTH,
  parentOf: (pid: number) => number | undefined = nativeParentOf,
): number[] {
  const chain: number[] = []
  const seen = new Set<number>()
  let current: number | undefined = process.pid
  while (current !== undefined && chain.length < maxDepth && !seen.has(current)) {
    seen.add(current)
    chain.push(current)
    current = parentOf(current)
  }
  return chain
}

/**
 * One hop up the chain from a pid, using only what Node core reports. A pid
 * outside this process has no natively visible parent; whatever `process.ppid`
 * reports joins the chain verbatim (a degenerate value simply protects a pid
 * no killer names).
 * @param pid - the pid whose parent is wanted.
 * @returns the parent pid, or undefined beyond Node's one-hop reach.
 */
function nativeParentOf(pid: number): number | undefined {
  if (pid !== process.pid) return undefined
  return process.ppid
}

/** Script-name endings whose stem is also a name the process answers to (`dsh.js` → `dsh`). */
const SCRIPT_NAME_EXTENSIONS = /\.(?:mjs|cjs|js|mts|cts|ts)$/

/**
 * Collect the command-name candidates this process answers to for name-based
 * killers: the interpreter binary (`node`), the entry script's file name and
 * stem (`dsh.js` and `dsh`), and the process title. Names are lowercased;
 * bash matching below is therefore exact-lowercase too, which matches how
 * POSIX process names (comm) behave.
 * @returns sorted unique candidate names, without path or `.exe` decoration.
 */
export function selfProcessNames(): string[] {
  const bases = [commandNameOf(process.argv[1]), commandNameOf(process.title), commandNameOf(process.execPath)]
  const names = new Set<string>()
  for (const base of bases) {
    /* v8 ignore next 2 -- no Node-started process reports an empty or spaced identity here, but an embedder-set title can. */
    if (base.length === 0 || base.includes(' ')) continue
    names.add(base)
    if (SCRIPT_NAME_EXTENSIONS.test(base)) names.add(base.slice(0, base.lastIndexOf('.')))
  }
  return [...names].sort()
}

/** Peel one level of matching quotes so quoted operands compare as themselves. */
function stripQuotes(token: string): string {
  const stripped = /^["'](.*)["']$/.exec(token)
  if (stripped === null) return token
  return stripped[1] as string
}

/**
 * Reduce one raw token to its file-name form: last path segment (either
 * separator), quotes peeled, `.exe` suffix dropped, original case preserved.
 * @param raw - the token as written.
 * @returns the bare file name, possibly still capitalized.
 */
function pathFile(raw: string): string {
  const unquoted = stripQuotes(raw)
  const cut = Math.max(unquoted.lastIndexOf('/'), unquoted.lastIndexOf('\\')) + 1
  const file = unquoted.slice(cut)
  return file.toLowerCase().endsWith('.exe') ? file.slice(0, -4) : file
}

/**
 * Comparable command-name form of a token: {@link pathFile}, lowercased.
 * PowerShell verbs and Windows image names are case-insensitive; bash verbs
 * go through {@link pathFile} instead so POSIX case sensitivity holds.
 * @param raw - the token as written, or undefined (reads as the empty name).
 * @returns the lowercase bare command name.
 */
function commandNameOf(raw: string | undefined): string {
  /* v8 ignore next -- argv[1] is absent only for a stdin/-e entry, which never hosts this harness. */
  if (raw === undefined) return ''
  return pathFile(raw).toLowerCase()
}

/** Tokens that end the current simple command; whatever follows is another command (or a piped feeder). */
const COMMAND_OPERATORS = new Set([';', '|', '&&', '||', '&'])

/** One whitespace-delimited simple command plus the operator that chained it to the previous one. */
interface Segment {
  readonly tokens: string[]
  /** Operator joining this segment to the previous one; undefined for the first segment. */
  readonly joiner: string | undefined
}

/**
 * Split the token stream into simple commands at shell operators.
 * @param tokens - the whitespace tokens of the whole command line.
 * @returns the non-empty segments in order, each carrying its joining operator.
 */
function splitSegments(tokens: readonly string[]): Segment[] {
  const segments: Segment[] = []
  let current: string[] = []
  let joiner: string | undefined
  for (const token of tokens) {
    if (COMMAND_OPERATORS.has(token)) {
      if (current.length > 0) segments.push({ tokens: current, joiner })
      current = []
      joiner = token
    } else {
      current.push(token)
    }
  }
  if (current.length > 0) segments.push({ tokens: current, joiner })
  return segments
}

/** Integer-looking pid spellings only; `$PID`, `%1`, `12a` are not resolvable targets. */
const PID_PATTERN = /^-?\d+$/

/**
 * Parse one token as a literal pid operand.
 * @param token - the raw operand token.
 * @returns the pid, or null when the token is not a plain integer.
 */
function asPid(token: string): number | null {
  if (!PID_PATTERN.test(token)) return null
  const parsed = Number.parseInt(token, 10)
  return Number.isSafeInteger(parsed) ? parsed : null
}

/**
 * Classify one pid operand against the protected set, plus the two special
 * spellings that necessarily include the host under local executors: pid 0
 * (the caller's whole process group) and pid -1 (every accessible process).
 * Other negative pids name process groups this process cannot portably
 * resolve, so they stay ungated rather than guessed at.
 * @param pid - the parsed operand.
 * @param protectedPids - the pids whose termination ends this session.
 * @returns the human-readable hit detail, or undefined when the pid is allowed.
 */
function pidVerdict(pid: number, protectedPids: ReadonlySet<number>): string | undefined {
  if (pid === 0) return "the caller's whole process group"
  if (pid === -1) return 'every process accessible to this user'
  if (protectedPids.has(pid)) return `pid ${pid}`
  return undefined
}

/**
 * Classify one name operand against the host's name candidates. Exact
 * equality only — pkill patterns are extended regexes, but honoring regex
 * syntax here would either over-block innocuous patterns or hand-roll a
 * regex engine; a spelled-out exact name is the unique-correspondence bar.
 * Folding follows the NAME's platform, not the wrapping shell: PowerShell
 * process names and Windows image names are case-insensitive even when
 * reached from Git Bash, while POSIX process names (comm) are not.
 * @param raw - the raw operand token.
 * @param foldToLower - whether the name's platform folds case (pwsh names and Windows images: yes, POSIX comm: no).
 * @param selfNames - the lowercase name candidates of the host.
 * @returns the human-readable hit detail, or undefined when the name is allowed.
 */
function nameVerdict(raw: string, foldToLower: boolean, selfNames: ReadonlySet<string>): string | undefined {
  const name = foldToLower ? commandNameOf(raw) : pathFile(stripQuotes(raw))
  if (name.length > 0 && selfNames.has(name)) return `process name '${name}'`
  return undefined
}

/** Shared flag walker for the pattern-taking killers: skips options, collects plain operands. */
function scanOperands(
  tokens: readonly string[],
  start: number,
  valueFlags: ReadonlySet<string>,
): string[] {
  const operands: string[] = []
  let index = start
  let operandsOnly = false
  let expectValue = false
  while (index < tokens.length) {
    const token = tokens[index] as string
    if (expectValue) {
      expectValue = false
      index += 1
      continue
    }
    if (!operandsOnly && token === '--') {
      operandsOnly = true
      index += 1
      continue
    }
    if (!operandsOnly && token.startsWith('-')) {
      if (valueFlags.has(token)) expectValue = true
      index += 1
      continue
    }
    operands.push(token)
    index += 1
  }
  return operands
}

/** Option/value pairs whose value is a signal name or number, not a target. */
const SIGNAL_VALUE_FLAGS = new Set(['-s', '--signal'])

/**
 * Inspect one `kill` invocation: signal specs are skipped (interspersed
 * freely, as both the builtin and GNU kill allow), every remaining integer
 * operand is a pid.
 * @param tokens - the segment's tokens.
 * @param start - index of the `kill` verb token.
 * @param protectedPids - the pids whose termination ends this session.
 * @returns the hit detail, or undefined when no operand lands on the host.
 */
function inspectBashKill(
  tokens: readonly string[],
  start: number,
  protectedPids: ReadonlySet<number>,
): string | undefined {
  return scanOperands(tokens, start + 1, SIGNAL_VALUE_FLAGS).reduce<string | undefined>(
    (found, operand) => {
      if (found !== undefined) return found
      const pid = asPid(operand)
      return pid === null ? undefined : pidVerdict(pid, protectedPids)
    },
    undefined,
  )
}

/**
 * Inspect one `pkill` invocation: the first plain operand is the pattern.
 * @param tokens - the segment's tokens.
 * @param start - index of the `pkill` verb token.
 * @param _protectedPids - present for table-signature uniformity; pkill targets by name only.
 * @param dialect - which case-folding rule applies.
 * @param selfNames - the lowercase name candidates of the host.
 * @returns the hit detail, or undefined when the pattern does not name the host.
 */
function inspectPkill(
  tokens: readonly string[],
  start: number,
  _protectedPids: ReadonlySet<number>,
  dialect: ShellDialect,
  selfNames: ReadonlySet<string>,
): string | undefined {
  const operands = scanOperands(tokens, start + 1, SIGNAL_VALUE_FLAGS)
  const pattern = operands[0]
  if (pattern === undefined) return undefined
  return nameVerdict(pattern, dialect === 'pwsh', selfNames)
}

/**
 * Inspect one `killall` invocation: every plain operand is a process name.
 * @param tokens - the segment's tokens.
 * @param start - index of the `killall` verb token.
 * @param _protectedPids - present for table-signature uniformity; killall targets by name only.
 * @param dialect - which case-folding rule applies.
 * @param selfNames - the lowercase name candidates of the host.
 * @returns the hit detail, or undefined when no name lands on the host.
 */
function inspectKillall(
  tokens: readonly string[],
  start: number,
  _protectedPids: ReadonlySet<number>,
  dialect: ShellDialect,
  selfNames: ReadonlySet<string>,
): string | undefined {
  const operands = scanOperands(tokens, start + 1, SIGNAL_VALUE_FLAGS)
  return operands.reduce<string | undefined>(
    (found, operand) => found ?? nameVerdict(operand, dialect === 'pwsh', selfNames),
    undefined,
  )
}

/** PowerShell process-enumeration cmdlets whose piped output can feed a terminator. */
const ENUMERATE_VERBS = new Set(['get-process', 'ps', 'gps'])

/** Terminating cmdlets and aliases (`kill` is a built-in Stop-Process alias). */
const PWSH_TERMINATE_VERBS = new Set(['stop-process', 'spps', 'kill'])

/** PowerShell switches carrying the termination target. */
const PWSH_ID_FLAGS = new Set(['-id'])
const PWSH_NAME_FLAGS = new Set(['-name'])

/**
 * Split one PowerShell list argument (`-Id 123,456` arrives as one token).
 * @param token - the raw argument token, or undefined when the list is missing.
 * @returns the comma-separated parts, empties dropped.
 */
function splitCommaList(token: string | undefined): string[] {
  if (token === undefined) return []
  return token.split(',').filter(part => part.length > 0)
}

/**
 * Inspect one Stop-Process invocation (direct forms only): `-Id`/positional
 * integers are pids, `-Name`/positional names are names, lists expand.
 * @param tokens - the segment's tokens.
 * @param start - index of the terminator verb token.
 * @param protectedPids - the pids whose termination ends this session.
 * @param selfNames - the lowercase name candidates of the host.
 * @returns the hit detail, or undefined when no target lands on the host.
 */
function inspectPwshTerminate(
  tokens: readonly string[],
  start: number,
  protectedPids: ReadonlySet<number>,
  selfNames: ReadonlySet<string>,
): string | undefined {
  let index = start + 1
  while (index < tokens.length) {
    const token = tokens[index] as string
    const flag = token.toLowerCase()
    if (PWSH_ID_FLAGS.has(flag) || PWSH_NAME_FLAGS.has(flag)) {
      index += 1
      const parts = splitCommaList(tokens[index])
      for (const part of parts) {
        const verdict = PWSH_ID_FLAGS.has(flag) ? listPartPidVerdict(part, protectedPids) : nameVerdict(part, true, selfNames)
        if (verdict !== undefined) return verdict
      }
      index += 1
      continue
    }
    if (flag.startsWith('-')) {
      index += 1
      continue
    }
    const pid = asPid(stripQuotes(token))
    const verdict = pid === null ? nameVerdict(token, true, selfNames) : pidVerdict(pid, protectedPids)
    if (verdict !== undefined) return verdict
    index += 1
  }
  return undefined
}

/**
 * Classify one comma-list member that carries a pid.
 * @param part - the raw list member.
 * @param protectedPids - the pids whose termination ends this session.
 * @returns the hit detail, or undefined when the member is allowed or unparsable.
 */
function listPartPidVerdict(part: string, protectedPids: ReadonlySet<number>): string | undefined {
  const pid = asPid(stripQuotes(part))
  return pid === null ? undefined : pidVerdict(pid, protectedPids)
}

/**
 * Walk the pipe chain feeding a terminator segment back through process
 * enumerations. An enumeration with no name filter selects every process —
 * the host included — so it matches outright; a named enumeration matches
 * when one of its names is ours.
 * @param segments - all segments of the command line.
 * @param index - index of the terminator segment.
 * @param selfNames - the lowercase name candidates of the host.
 * @returns the hit detail, or undefined when no feeder enumeration targets the host.
 */
function pipedEnumerationVerdict(
  segments: readonly Segment[],
  index: number,
  selfNames: ReadonlySet<string>,
): string | undefined {
  let back = index - 1
  while (back >= 0) {
    const segment = segments[back] as Segment
    // Segments are never empty by construction (splitSegments drops empties).
    if (!ENUMERATE_VERBS.has(commandNameOf(segment.tokens[0]))) return undefined
    const names = enumerationNameOperands(segment.tokens)
    if (names.length === 0) return 'an unfiltered process enumeration'
    for (const name of names) {
      const verdict = nameVerdict(name, true, selfNames)
      if (verdict !== undefined) return verdict
    }
    if (segment.joiner !== '|') return undefined
    back -= 1
  }
  return undefined
}

/**
 * Collect the name operands of one enumeration segment: positional tokens
 * bind to `-Name`, as does the value of an explicit `-Name`.
 * @param tokens - the enumeration segment's tokens.
 * @returns the raw name operands in order.
 */
function enumerationNameOperands(tokens: readonly string[]): string[] {
  const names: string[] = []
  let index = 1
  let expectName = false
  while (index < tokens.length) {
    const token = tokens[index] as string
    if (expectName) {
      names.push(token)
      expectName = false
      index += 1
      continue
    }
    const flag = token.toLowerCase()
    if (flag.startsWith('-')) {
      if (PWSH_NAME_FLAGS.has(flag)) expectName = true
      index += 1
      continue
    }
    names.push(token)
    index += 1
  }
  return names
}

/** taskkill switch letters that carry a target value. */
const TASKKILL_VALUE_FLAGS = new Set(['pid', 'im', 'fi'])

/**
 * Read one option value, rejoining a quoted value that the whitespace
 * tokenizer tore apart (`/FI "IMAGENAME eq node.exe"`).
 * @param tokens - the segment's tokens.
 * @param index - index of the first value token.
 * @returns the rejoined raw value and the index just past it.
 */
function readOptionValue(tokens: readonly string[], index: number): { value: string; next: number } {
  const first = (tokens[index] ?? '')
  if (first.startsWith('"') && !first.endsWith('"')) {
    const parts: string[] = [first]
    let cursor = index + 1
    while (cursor < tokens.length && !(tokens[cursor] as string).endsWith('"')) {
      parts.push(tokens[cursor] as string)
      cursor += 1
    }
    if (cursor < tokens.length) {
      parts.push(tokens[cursor] as string)
      return { value: parts.join(' '), next: cursor + 1 }
    }
    return { value: parts.join(' '), next: cursor }
  }
  return { value: first, next: index + 1 }
}

/**
 * Inspect one `taskkill` invocation (usable from both dialects on Windows):
 * `/PID` pids, `/IM` image names, `/FI` filters selecting by image name or
 * pid. MSYS-style doubled slashes (`//PID`) fold like single ones.
 * @param tokens - the segment's tokens.
 * @param start - index of the `taskkill` verb token.
 * @param protectedPids - the pids whose termination ends this session.
 * @param selfNames - the lowercase name candidates of the host.
 * @returns the hit detail, or undefined when no target lands on the host.
 */
function inspectTaskkill(
  tokens: readonly string[],
  start: number,
  protectedPids: ReadonlySet<number>,
  selfNames: ReadonlySet<string>,
): string | undefined {
  let index = start + 1
  while (index < tokens.length) {
    const token = tokens[index] as string
    const flag = token.replace(/^[-/]+/, '').toLowerCase()
    if (TASKKILL_VALUE_FLAGS.has(flag)) {
      const read = readOptionValue(tokens, index + 1)
      const verdict = flag === 'fi'
        ? filterVerdict(read.value, protectedPids, selfNames)
        : taskkillTargetVerdict(flag, read.value, protectedPids, selfNames)
      if (verdict !== undefined) return verdict
      index = read.next
      continue
    }
    index += 1
  }
  return undefined
}

/**
 * Classify one `/PID` or `/IM` value (comma lists included).
 * @param flag - the normalized switch letter ('pid' or 'im').
 * @param value - the raw option value.
 * @param protectedPids - the pids whose termination ends this session.
 * @param selfNames - the lowercase name candidates of the host.
 * @returns the hit detail, or undefined when the value is allowed.
 */
function taskkillTargetVerdict(
  flag: string,
  value: string,
  protectedPids: ReadonlySet<number>,
  selfNames: ReadonlySet<string>,
): string | undefined {
  for (const part of splitCommaList(value)) {
    const verdict = flag === 'pid' ? listPartPidVerdict(part, protectedPids) : nameVerdict(part, true, selfNames)
    if (verdict !== undefined) return verdict
  }
  return undefined
}

/** Filter prefixes under `taskkill /FI` that select by our target kinds; only `eq` selects. */
const IMAGENAME_EQ_PREFIX = 'imagename eq '
const PID_EQ_PREFIX = 'pid eq '

/**
 * Classify one `/FI` filter string. Only equality filters on image name or
 * pid can single the host out; every other filter kind or comparison passes.
 * @param raw - the raw filter value (possibly quoted, torn apart by tokenization and rejoined).
 * @param protectedPids - the pids whose termination ends this session.
 * @param selfNames - the lowercase name candidates of the host.
 * @returns the hit detail, or undefined when the filter does not select the host.
 */
function filterVerdict(
  raw: string,
  protectedPids: ReadonlySet<number>,
  selfNames: ReadonlySet<string>,
): string | undefined {
  const filter = stripQuotes(raw).trim().toLowerCase()
  if (filter.startsWith(IMAGENAME_EQ_PREFIX)) {
    return nameVerdict(filter.slice(IMAGENAME_EQ_PREFIX.length), true, selfNames)
  }
  if (filter.startsWith(PID_EQ_PREFIX)) {
    const pid = asPid(stripQuotes(filter.slice(PID_EQ_PREFIX.length)))
    return pid === null ? undefined : pidVerdict(pid, protectedPids)
  }
  return undefined
}

/** Uniform signature every bash termination inspector answers to (table-dispatched). */
type BashTerminationInspector = (
  tokens: readonly string[],
  start: number,
  protectedPids: ReadonlySet<number>,
  dialect: ShellDialect,
  selfNames: ReadonlySet<string>,
) => string | undefined

/** Per-dialect inspectors for the bash termination commands. */
const BASH_TERMINATORS: Record<string, BashTerminationInspector> = {
  kill: inspectBashKill,
  pkill: inspectPkill,
  killall: inspectKillall,
}

/**
 * Compose the refusal reason naming what would die and where restarts belong.
 * @param detail - the human-readable description of the matched target.
 * @returns the full refusal message carried to the model.
 */
function reasonFor(detail: string): string {
  return 'this command would terminate this harness host process itself '
    + `(${detail}) — restarting the dsh service must happen from an external terminal `
    + 'or through a supervised restart flow; running sessions are persisted and recoverable'
}

/**
 * Detect a command that terminates the harness host process itself or an
 * ancestor of it. Scans every simple command in the line (operators split
 * them) and every token position inside a segment, so a termination hidden
 * behind an earlier harmless word (`sudo kill`, `xargs kill`) still matches;
 * the price is occasional false positives on commands that merely mention a
 * killer next to a protected pid, accepted because a refusal retries and a
 * dead host does not.
 * @param probe - the command plus the host's pid and name identities.
 * @returns the human-readable refusal reason, or undefined when nothing matches.
 */
export function selfTerminationCommand(probe: SelfKillProbe): string | undefined {
  // Quote- and operator-aware tokenization: glued operators (`kill 4242&&echo x`)
  // must split so neither pid nor next verb hides inside a token.
  const tokens = tokenizeCommandLine(probe.command)
  const segments = splitSegments(tokens)
  const protectedPids = new Set(probe.protectedPids)
  const selfNames = new Set(probe.selfNames)
  for (let index = 0; index < segments.length; index += 1) {
    const verdict = inspectSegment(segments[index] as Segment, segments, index, probe.dialect, protectedPids, selfNames)
    if (verdict !== undefined) return reasonFor(verdict)
  }
  return undefined
}

/**
 * Inspect one simple command for termination verbs aimed at the host.
 * @param segment - the segment under inspection.
 * @param segments - all segments (for the pipeline lookback).
 * @param index - the segment's index.
 * @param dialect - which dialect's verb spellings and case rules apply.
 * @param protectedPids - the pids whose termination ends this session.
 * @param selfNames - the lowercase name candidates of the host.
 * @returns the hit detail, or undefined when the segment is allowed.
 */
function inspectSegment(
  segment: Segment,
  segments: readonly Segment[],
  index: number,
  dialect: ShellDialect,
  protectedPids: ReadonlySet<number>,
  selfNames: ReadonlySet<string>,
): string | undefined {
  const tokens = segment.tokens
  for (let position = 0; position < tokens.length; position += 1) {
    const token = tokens[position] as string
    if (commandNameOf(token) === 'taskkill') {
      const verdict = inspectTaskkill(tokens, position, protectedPids, selfNames)
      if (verdict !== undefined) return verdict
      continue
    }
    if (dialect === 'bash') {
      const inspector = BASH_TERMINATORS[pathFile(token)]
      if (inspector === undefined) continue
      const verdict = inspector(tokens, position, protectedPids, dialect, selfNames)
      if (verdict !== undefined) return verdict
      continue
    }
    if (PWSH_TERMINATE_VERBS.has(commandNameOf(token))) {
      const verdict = inspectPwshTerminate(tokens, position, protectedPids, selfNames)
      if (verdict !== undefined) return verdict
    }
  }
  if (dialect === 'pwsh' && segment.joiner === '|' && segment.tokens.length > 0
    && PWSH_TERMINATE_VERBS.has(commandNameOf(segment.tokens[0]))) {
    return pipedEnumerationVerdict(segments, index, selfNames)
  }
  return undefined
}
