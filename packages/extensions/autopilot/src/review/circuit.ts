/**
 * Review circuit breaker.
 *
 * Defaults are DERIVED, not vibes: window 6-of-10 is reachable only because a
 * turn allows at most 10 real AI verdicts — a stricter window could never fire
 * first, a looser one would not protect the human chain.
 */
import type { RandomSource } from '../kernel/ledger.js'

/** Trip thresholds and the action taken when the review circuit opens. */
export interface CircuitConfig {
  consecutiveDenials: number
  windowSize: number
  windowDenials: number
  action: 'delegate' | 'reject' | 'abort-turn'
}

/** Derived default thresholds (see module doc for their rationale). */
export const CIRCUIT_DEFAULTS: CircuitConfig = {
  consecutiveDenials: 3,
  windowSize: 10,
  windowDenials: 6,
  action: 'delegate',
}

/** Current circuit position, as consumed by callers deciding to delegate. */
export interface CircuitState {
  tripped: boolean
  action: CircuitConfig['action']
}

/** Sliding-window breaker over reviewer denials. */
export class ReviewCircuit {
  private consecutive = 0
  /** Denial outcomes within the sliding window (true = denial). */
  private window: boolean[] = []

  constructor(
    readonly config: CircuitConfig = CIRCUIT_DEFAULTS,
    private readonly rng?: RandomSource,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Feed one reviewer outcome into the sliding window and streak counters.
   * @param decision - the verdict the reviewer returned.
   * @param escalatedToDenial - treat an `allow` as a denial (escalation path).
   */
  record(decision: 'allow' | 'deny', escalatedToDenial = false): void {
    const isDenial = decision === 'deny' || escalatedToDenial
    this.window.push(isDenial)
    while (this.window.length > this.config.windowSize) this.window.shift()
    if (isDenial) {
      this.consecutive += 1
    } else {
      this.consecutive = 0
    }
  }

  /** Trip status plus the configured action, as a plain snapshot. */
  get state(): CircuitState {
    return {
      tripped: this.isTripped(),
      action: this.config.action,
    }
  }

  /**
   * Whether the consecutive streak or the window density has crossed its threshold.
   * @returns true when the circuit is open and review should be bypassed.
   */
  isTripped(): boolean {
    if (this.consecutive >= this.config.consecutiveDenials) return true
    const denialsInWindow =
      this.window.filter(d => d).length
    return denialsInWindow >= this.config.windowDenials && this.window.length >= Math.min(this.config.windowSize, this.config.windowDenials)
  }

  /** Reset after human intervention or an explicit cool-off. */
  reset(): void {
    this.consecutive = 0
    this.window = []
  }

  /**
   * Compact encoding of the streak and window for equality checks in tests.
   * @returns a `consecutive:window-bits` token string.
   */
  snapshotToken(): string {
    void this.rng
    void this.now
    return `${this.consecutive}:${this.window.map(d => (d ? '1' : '0')).join('')}`
  }
}
