/**
 * Bounded-restart accounting shared by the guardian entry and the runtime
 * surface: at most `max` restarts inside any `windowMs`, then the circuit
 * stays open (give-up) until an operator intervenes.
 */
export class RestartBudget {
  private attempts: number[] = []

  constructor(
    private readonly windowMs = 5 * 60_000,
    private readonly max = 3,
  ) {}

  /**
   * Would another restart right now still be within budget?
   * @param nowMs - the current time in milliseconds.
   * @returns true when fewer than `max` restarts happened in the window.
   */
  canRestart(nowMs: number): boolean {
    this.prune(nowMs)
    return this.attempts.length < this.max
  }

  /**
   * Record one restart attempt in the current window.
   * @param nowMs - the current time in milliseconds.
   */
  record(nowMs: number): void {
    this.prune(nowMs)
    this.attempts.push(nowMs)
  }

  /**
   * Number of restarts already spent in the current window.
   * @param nowMs - the current time in milliseconds.
   * @returns the count of restarts still inside the window.
   */
  used(nowMs: number): number {
    this.prune(nowMs)
    return this.attempts.length
  }

  /** Forget every recorded restart attempt. */
  reset(): void {
    this.attempts = []
  }

  private prune(nowMs: number): void {
    const cutoff = nowMs - this.windowMs
    this.attempts = this.attempts.filter(t => t >= cutoff)
  }
}

/** The observed health verdict feeding the guardian decision. */
export type ProbeVerdict = { kind: 'healthy' } | { kind: 'unhealthy' }

/** What the guardian does with a probe verdict. */
export type GuardianAction = 'none' | 'restart' | 'give-up'

/**
 * Pure decision step used by the guardian loop on every probe tick.
 * @param input - the probe verdict, restart budget, and current time.
 * @returns `none` when healthy, `restart` in budget, else `give-up`.
 */
export function decideAction(input: {
  verdict: ProbeVerdict
  budget: RestartBudget
  nowMs: number
}): GuardianAction {
  if (input.verdict.kind === 'healthy') return 'none'
  return input.budget.canRestart(input.nowMs) ? 'restart' : 'give-up'
}
