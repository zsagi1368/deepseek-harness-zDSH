/**
 * Quote-aware, operator-aware command tokenization shared by the destructive
 * -command detectors. Whitespace splitting alone is exploitable: a single
 * glued operator (`rm -rf .&&echo done`, `kill 4242&&echo x`) hides both the
 * operand and the next verb from any whole-token match, so operators are
 * split out even without surrounding whitespace, and quoted spans survive as
 * one token with their quotes dropped.
 * @module @deepseek-ai/dsh-shell/command-tokenize
 */

/** Operator tokens guaranteed to come back standalone. */
export const TOKEN_OPERATORS = new Set([';', '|', '&&', '||', '&'])

/**
 * Tokenize one shell command line.
 * @param command - the raw command line, verbatim.
 * @returns tokens in order; every operator is a standalone single-token entry, quoted spans keep interior whitespace.
 */
export function tokenizeCommandLine(command: string): string[] {
  const out: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  const flush = (): void => {
    if (current.length > 0) {
      out.push(current)
      current = ''
    }
  }
  let index = 0
  while (index < command.length) {
    const ch = command.charAt(index)
    if (quote !== null) {
      if (ch === quote) {
        quote = null
      } else {
        current += ch
      }
      index += 1
      continue
    }
    if (ch === '"' || ch === "'") {
      // Group only when the quote CLOSES; an unterminated opener is a literal
      // character, keeping torn fragments (`taskkill /FI "IMAGENAME eq x`)
      // split exactly as the whitespace shell would have left them.
      const closesAt = command.indexOf(ch, index + 1)
      if (closesAt === -1) {
        current += ch
        index += 1
        continue
      }
      quote = ch
      index += 1
      continue
    }
    const pair = command.slice(index, index + 2)
    if (pair === '&&' || pair === '||') {
      flush()
      out.push(pair)
      index += 2
      continue
    }
    if (ch === ';' || ch === '|' || ch === '&') {
      flush()
      out.push(ch)
      index += 1
      continue
    }
    if (/\s/.test(ch)) {
      flush()
      index += 1
      continue
    }
    current += ch
    index += 1
  }
  flush()
  return out
}
