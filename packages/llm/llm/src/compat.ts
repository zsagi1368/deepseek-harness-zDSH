/**
 * Version-adaptive guard for the D-005 truncatedToolCalls enhancement.
 *
 * The official (upstream) `BlockAssembler` has no `truncatedToolCalls` method
 * and its `step()` ends cleanly on max-tokens, so the zDSH enhancement
 * (fail-loud on unclosed/bad tool-call parameters) cannot be expressed on the
 * official assembler: probing failure disables the zDSH checks entirely and
 * the official behaviour already covers the primary semantics. We do not
 * fall back to the old version (signature incompatible).
 *
 * @module @deepseek-ai/dsh-llm
 */

import { guardFeature, consoleCompatLogger } from '@deepseek-ai/dsh-compat'

/**
 * Probe whether the loaded `@deepseek-ai/dsh-llm` exposes the
 * `truncatedToolCalls` enhancement (D-005). Returns `true` only when both
 * the `BlockAssembler.truncatedToolCalls` method and the
 * `TRUNCATED_TOOL_CALL_CODE` constant are present; otherwise logs a warning
 * and returns `false` so callers skip the zDSH checks. Never throws.
 *
 * @param logger - Optional logger for the disable diagnostic; defaults to `console`.
 * @returns Whether the D-005 enhancement is available and may be used.
 */
export async function guardTruncatedToolCalls(logger = consoleCompatLogger()): Promise<boolean> {
  const verdict = await guardFeature('dsh-truncated-tool-calls', {
    deps: [
      {
        name: 'llm:BlockAssembler',
        run: async () => {
          try {
            const { BlockAssembler } = await import('@deepseek-ai/dsh-llm')
            const hasMethod = typeof BlockAssembler === 'function'
              && typeof BlockAssembler.prototype.truncatedToolCalls === 'function'
            return hasMethod ? null : 'BlockAssembler.truncatedToolCalls not found'
          } catch {
            return 'cannot import BlockAssembler'
          }
        },
      },
      {
        name: 'llm:TRUNCATED_TOOL_CALL_CODE',
        run: async () => {
          try {
            const { TRUNCATED_TOOL_CALL_CODE } = await import('@deepseek-ai/dsh-llm')
            return typeof TRUNCATED_TOOL_CALL_CODE === 'string'
              ? null
              : 'TRUNCATED_TOOL_CALL_CODE not a string'
          } catch {
            return 'cannot import TRUNCATED_TOOL_CALL_CODE'
          }
        },
      },
    ],
    logger,
  })
  return verdict.enabled
}
