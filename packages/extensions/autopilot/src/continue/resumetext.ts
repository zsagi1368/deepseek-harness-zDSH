/**
 * Resume text templates with placeholder filling and idempotency guardrails.
 *
 * The guardrail suffix depends on where the previous turn died: a tool whose
 * result never arrived gets "confirm first, do not redo", a tool that clearly
 * succeeded gets "already done, continue after it", and a failed tool gets NO
 * guardrail — retrying it is the whole point.
 */
export type TemplateKind = 'continue' | 'continue-max-tokens' | 'loop'

/** Placeholder context filled into resume text templates. */
export interface TemplateContext {
  code?: string
  message?: string
  status?: string
  tool?: string
  turn?: string
  elapsedMs?: number
}

/** State of the previous tool call, driving the guardrail suffix choice. */
export type GuardToolState = 'pending' | 'done' | 'failed'

/** Guardrail suffix texts per tool state. */
export interface GuardTexts {
  pending?: string
  done?: string
  failed?: string
}

/**
 * Format a millisecond duration as a compact `MmSs` label.
 * @param ms - the elapsed duration in milliseconds.
 * @returns the formatted duration label.
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return minutes > 0 ? `${minutes}m${seconds}s` : `${seconds}s`
}

/**
 * Replace `{placeholder}` tokens in a template from the context.
 * @param template - the text template.
 * @param ctx - the placeholder values available for substitution.
 * @returns the filled template.
 */
export function fillTemplate(template: string, ctx: TemplateContext): string {
  const replacements: Record<string, string> = {
    code: ctx.code ?? 'unknown',
    message: (ctx.message ?? '').slice(0, 200),
    status: ctx.status ?? '',
    tool: ctx.tool ?? '',
    turn: ctx.turn ?? '',
    elapsed: ctx.elapsedMs === undefined ? '' : formatElapsed(ctx.elapsedMs),
  }
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => replacements[key] ?? whole)
}

/**
 * Build the final resume prompt for a kind, filling placeholders and appending
 * the idempotency guardrail when the previous tool state is known.
 * @param args - kind, texts, context, and optional guard state.
 * @returns the assembled resume text.
 */
export function buildResumeText(args: {
  kind: TemplateKind
  texts: { continue: string; continueMaxTokens: string; loop: string }
  ctx: TemplateContext
  guardState?: GuardToolState
  guards: GuardTexts
}): string {
  const base =
    args.kind === 'loop'
      ? args.texts.loop
      : args.kind === 'continue-max-tokens'
        ? args.texts.continueMaxTokens
        : args.texts.continue
  let text = fillTemplate(base, args.ctx)

  if (args.kind !== 'loop' && args.guardState) {
    const suffix =
      args.guardState === 'pending'
        ? args.guards.pending
        : args.guardState === 'done'
          ? args.guards.done
          : undefined // failed → no guardrail: retrying IS the intent
    if (suffix) text = `${text}\n\n${fillTemplate(suffix, { ...args.ctx })}`
  }
  return text
}
