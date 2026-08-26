/**
 * Argument-surface hardening for the pwsh tool (#121). Field reports show
 * sessions burning their whole budget on `invalid arguments: missing required
 * property "command"` loops: a provider that emits an empty/partial argument
 * object parses to `{}` (agent-loop maps empty input to `{}`), validation
 * fails, and the terse violation gives the model nothing to correct — so it
 * repeats the identical call. Two defenses live here:
 *
 * 1. {@link normalizePwshArguments} salvages near-miss shapes before schema
 *    validation — today only a JSON-encoded object string (a real weak-model
 *    behavior), kept conservative on purpose.
 * 2. {@link enrichInvalidArgsError} re-renders the missing-`command` failure
 *    with the RECEIVED shape and explicit resend guidance, which is what
 *    breaks a repeat loop: the model can tell its arguments never arrived.
 * @module @deepseek-ai/dsh-tool-pwsh/args
 */

import { ToolArgsError } from '@deepseek-ai/dsh-tools'

/**
 * Normalize model arguments into the shape schema validation expects.
 * @param args - the raw parsed arguments however malformed.
 * @returns The parsed object when `args` is a string that decodes to a plain
 *   JSON object (double-encoded arguments), otherwise the input unchanged.
 */
export function normalizePwshArguments(args: unknown): unknown {
  if (typeof args !== 'string') return args
  try {
    const parsed: unknown = JSON.parse(args)
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) return parsed
  } catch {
    // Not salvageable JSON — validated as-is so the canonical error stands.
  }
  return args
}

/**
 * Describe received arguments in one bounded phrase for failure guidance.
 * @param args - the raw received arguments.
 * @returns A short shape summary (never echoes more than ~80 characters of content).
 */
export function describePwshArguments(args: unknown): string {
  if (args === undefined) return 'no arguments object'
  if (args === null) return 'null'
  if (typeof args === 'string') return `a JSON string (${JSON.stringify(args.length > 80 ? `${args.slice(0, 80)}...` : args)})`
  if (Array.isArray(args)) return 'a JSON array'
  if (typeof args !== 'object') return `a ${typeof args}`
  const keys = Object.keys(args)
  if (keys.length === 0) return 'an object with no properties'
  const named = keys.slice(0, 8).join(', ')
  return `an object with properties ${named}${keys.length > 8 ? ', ...' : ''}`
}

/** The corrective suffix appended to missing-`command` failures; naming the expected shape is what lets the model stop repeating. */
const COMMAND_SHAPE_GUIDANCE = 'the pwsh tool requires JSON arguments shaped '
  + '{"command": "<one PowerShell command>", "description": "<5-10 words>"} '
  + '— resend complete valid arguments instead of repeating this call'

/**
 * Enrich the canonical invalid-arguments failure when `command` is missing,
 * appending the received shape and resend guidance; every other error passes
 * through untouched.
 * @param error - the thrown value from validated execution.
 * @param received - the RAW arguments as received (pre-normalization).
 * @returns The enriched {@link ToolArgsError}, or the original thrown value.
 */
export function enrichInvalidArgsError(error: unknown, received: unknown): unknown {
  if (!(error instanceof ToolArgsError)) return error
  if (!error.violations.some(violation => violation.includes('missing required property "command"'))) return error
  return new ToolArgsError([
    ...error.violations,
    `the call received ${describePwshArguments(received)}; ${COMMAND_SHAPE_GUIDANCE}`,
  ])
}
