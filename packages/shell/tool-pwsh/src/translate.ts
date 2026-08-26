/**
 * POSIX→PowerShell command translation at the pwsh tool entry (#53). Windows
 * sessions expose PowerShell as the shell seam, yet models habitually emit
 * POSIX utilities (`pwd && ls -la`); left alone those fail with PowerShell
 * parser errors that read like harness bugs. This module rewrites the common,
 * unambiguous forms into native cmdlet invocations and leaves everything it
 * cannot translate confidently untouched, so the command still runs as
 * written and PowerShell's own error guides the model.
 *
 * The rewrite is a pure, best-effort, per-segment transform: operators
 * (`&&`, `||`, `;`, `|`, `&`, newlines) split the line into simple commands,
 * redirections stay attached verbatim behind their translated prefix, and any
 * construct with divergent semantics (command substitution, unterminated
 * quotes, unrecognized flags) disables translation for the affected part.
 * Translated commands flow through the same gates as written ones — the
 * #149/#387 detectors evaluate the EFFECTIVE text, so a translated
 * `rm -rf .` is gated exactly like its PowerShell spelling.
 * @module @deepseek-ai/dsh-tool-pwsh/translate
 */

/**
 * One simple-command translator: the whitespace tokens of one segment head
 * (verbatim, quotes kept) in, the PowerShell replacement text out, or
 * `undefined` to leave that segment untranslated.
 */
type SimpleTranslator = (tokens: string[]) => string | undefined

/** Bundled short-flag cluster `-abc` → per-letter list; long or malformed options are rejected. */
function clusterChars(token: string): string[] | undefined {
  if (!token.startsWith('-') || token.length < 2 || token.startsWith('--')) return undefined
  return token.slice(1).split('')
}

/**
 * Consume leading flag tokens against a char→PS-flag table. Table values may
 * be '' (a recognized no-op letter such as ls's `l`); any UNRECOGNIZED letter
 * rejects the whole translation so unknown semantics never get rewritten.
 */
function flagsFor(
  tokens: string[],
  table: Readonly<Record<string, string>>,
): { flags: string[]; rest: string[] } | undefined {
  const chars: string[] = []
  let index = 0
  while (index < tokens.length) {
    const token = tokens[index] as string
    if (token === '-' || !token.startsWith('-')) break
    const expanded = clusterChars(token)
    if (expanded === undefined) return undefined
    chars.push(...expanded)
    index += 1
  }
  const flags: string[] = []
  let matched = 0
  for (const [char, flag] of Object.entries(table)) {
    if (!chars.includes(char)) continue
    matched += 1
    if (flag.length > 0) flags.push(flag)
  }
  if (matched !== chars.length) return undefined
  return { flags, rest: tokens.slice(index) }
}

/**
 * Build a translator for the common shape `<verb> [flags] <operands...>`:
 * flags map through {@link flagsFor}, operands pass through verbatim after
 * the fixed `prefix` (e.g. Select-String's `-Pattern`), and `minOperands`
 * enforces arity so bare verbs never rewrite into invalid cmdlet calls.
 */
function verb(
  psName: string,
  options: { flags?: Readonly<Record<string, string>>; minOperands?: number; prefix?: readonly string[] } = {},
): SimpleTranslator {
  return (tokens) => {
    const resolved = flagsFor(tokens.slice(1), options.flags ?? {})
    if (resolved === undefined) return undefined
    if (resolved.rest.length < (options.minOperands ?? 0)) return undefined
    return [
      psName,
      ...(options.prefix ?? []),
      ...resolved.flags,
      ...resolved.rest,
    ].join(' ')
  }
}

/** Translate `head -n N file...` / `tail -n N file...` onto Get-Content's window flags. */
function lineWindow(kind: 'TotalCount' | 'Tail'): SimpleTranslator {
  return (tokens) => {
    if (tokens.length < 4 || tokens[1] !== '-n') return undefined
    const count = tokens[2] as string
    if (!/^\d+$/.test(count)) return undefined
    return `Get-Content ${tokens.slice(3).join(' ')} -${kind} ${count}`
  }
}

const EXPORT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Translate `export NAME=value` onto `$env:NAME = 'value'`. One assignment
 * token only; surrounding quotes peel off and the value lands in a literal
 * single-quoted PowerShell string (internal quotes doubled).
 */
function translateExport(tokens: string[]): string | undefined {
  if (tokens.length !== 2) return undefined
  const assignment = tokens[1] as string
  const equals = assignment.indexOf('=')
  if (equals <= 0) return undefined
  const name = assignment.slice(0, equals)
  if (!EXPORT_NAME.test(name)) return undefined
  let value = assignment.slice(equals + 1)
  if (value.length >= 2
    && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    value = value.slice(1, -1)
  }
  if (value.includes('\n')) return undefined
  return `$env:${name} = '${value.replaceAll("'", "''")}'`
}

/**
 * The POSIX→PowerShell mapping table. Keys are lowercased command names;
 * every handler is conservative — anything outside its recognized shape
 * returns `undefined` and the segment runs as written.
 */
export const POSIX_TRANSLATIONS: Readonly<Record<string, SimpleTranslator>> = {
  pwd: tokens => (tokens.length === 1 ? 'Get-Location' : undefined),
  ls: verb('Get-ChildItem', { flags: { l: '', a: '-Force' } }),
  cat: verb('Get-Content'),
  cd: verb('Set-Location'),
  echo: verb('Write-Output'),
  rm: verb('Remove-Item', { flags: { r: '-Recurse', R: '-Recurse', f: '-Force' }, minOperands: 1 }),
  cp: verb('Copy-Item', { flags: { r: '-Recurse', R: '-Recurse' }, minOperands: 2 }),
  mv: verb('Move-Item', { minOperands: 2 }),
  mkdir: verb('New-Item', { flags: { p: '-Force' }, minOperands: 1, prefix: ['-ItemType', 'Directory'] }),
  which: verb('Get-Command', { minOperands: 1 }),
  grep: verb('Select-String', { minOperands: 1, prefix: ['-Pattern'] }),
  head: lineWindow('TotalCount'),
  tail: lineWindow('Tail'),
  env: tokens => (tokens.length === 1 ? 'Get-ChildItem Env:' : undefined),
  clear: tokens => (tokens.length === 1 ? 'Clear-Host' : undefined),
  export: translateExport,
}

/** Whitespace tokenizer that keeps quoted spans as single verbatim tokens; unterminated quotes reject translation. */
function tokenize(source: string): string[] | undefined {
  if (/\\["']/.test(source)) return undefined
  const tokens: string[] = []
  let current = ''
  let index = 0
  while (index < source.length) {
    const char = source[index] as string
    if (char === ' ' || char === '\t') {
      if (current.length > 0) tokens.push(current)
      current = ''
      index += 1
      continue
    }
    if (char === '"' || char === "'") {
      const end = source.indexOf(char, index + 1)
      if (end < 0) return undefined
      current += source.slice(index, end + 1)
      index = end + 1
      continue
    }
    current += char
    index += 1
  }
  if (current.length > 0) tokens.push(current)
  return tokens
}

/** One top-level segment: its raw source plus the operator that followed it ('' for the last). */
interface LineSegment {
  readonly text: string
  readonly separator: string
}

/**
 * Split a command line on operators, honoring quotes. Command substitution
 * (`$(`, backticks outside quotes) and the bare bash-background `&` reject
 * translation for the whole line.
 */
function splitLine(command: string): LineSegment[] | undefined {
  const segments: LineSegment[] = []
  let current = ''
  let index = 0
  while (index < command.length) {
    const char = command[index] as string
    if (char === '"' || char === "'") {
      const end = command.indexOf(char, index + 1)
      if (end < 0) return undefined
      current += command.slice(index, end + 1)
      index = end + 1
      continue
    }
    if (char === '`' || (char === '$' && command[index + 1] === '(')) return undefined
    const pair = command.slice(index, index + 2)
    if (pair === '&&' || pair === '||') {
      segments.push({ text: current, separator: pair })
      current = ''
      index += 2
      continue
    }
    if (char === ';' || char === '|' || char === '\n' || char === '\r') {
      segments.push({ text: current, separator: char })
      current = ''
      index += 1
      continue
    }
    // A bare `&` backgrounds in bash but has no clean PowerShell spelling;
    // translating around it would trade a clear error for a confusing one.
    if (char === '&') return undefined
    current += char
    index += 1
  }
  segments.push({ text: current, separator: '' })
  return segments
}

/** Split one segment at its first top-level redirection; the tail stays verbatim (PowerShell reads the same forms). */
function splitRedirect(segment: string): { head: string; tail: string } {
  let index = 0
  while (index < segment.length) {
    const char = segment[index] as string
    if (char === '"' || char === "'") {
      const end = segment.indexOf(char, index + 1)
      if (end < 0) break
      index = end + 1
      continue
    }
    const digitFd = /[0-9]/.test(char)
      && (segment[index + 1] === '>' || segment[index + 1] === '<')
      && (index === 0 || /\s/.test(segment[index - 1] as string))
    if (char === '>' || char === '<' || digitFd) {
      return { head: segment.slice(0, index).trim(), tail: segment.slice(index).trim() }
    }
    index += 1
  }
  return { head: segment.trim(), tail: '' }
}

function translateSimple(head: string): string | undefined {
  if (head.length === 0) return undefined
  const tokens = tokenize(head)
  if (tokens === undefined || tokens.length === 0) return undefined
  const translator = POSIX_TRANSLATIONS[(tokens[0] as string).toLowerCase()]
  return translator?.(tokens)
}

/**
 * Translate one model-written command line for PowerShell execution.
 * @param command - the raw command exactly as the model wrote it (callers may
 *   forward untyped presenter args; anything but a non-empty string is left
 *   untranslated).
 * @returns the effective PowerShell command when at least one segment was
 *   rewritten, or `undefined` when the line should run as written.
 */
export function translatePosixCommand(command: string): string | undefined {
  if (typeof command !== 'string' || command.length === 0) return undefined
  const segments = splitLine(command)
  if (segments === undefined) return undefined
  let changed = false
  const rebuilt: string[] = []
  for (const segment of segments) {
    const { head, tail } = splitRedirect(segment.text)
    const translated = translateSimple(head)
    if (translated !== undefined) changed = true
    rebuilt.push(tail.length > 0 ? `${translated ?? head} ${tail}` : translated ?? head)
    // Keep line separators bare; space out the printed operators so the
    // effective text stays readable (`Get-Location && Get-ChildItem`).
    rebuilt.push(segment.separator === '\n' || segment.separator === '\r' || segment.separator === ''
      ? segment.separator
      : ` ${segment.separator} `)
  }
  if (!changed) return undefined
  return rebuilt.join('')
}

/**
 * Build the model-facing note that discloses a translation, keeping the
 * executed text auditable next to its results.
 * @param command - the raw model-written command.
 * @returns one `[translated to PowerShell: ...]` line, or `undefined` when
 *   nothing was rewritten.
 */
export function posixTranslationNote(command: string): string | undefined {
  const effective = translatePosixCommand(command)
  return effective === undefined ? undefined : `[translated to PowerShell: ${effective}]`
}
