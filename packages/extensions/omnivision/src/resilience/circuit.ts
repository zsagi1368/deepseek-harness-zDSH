/**
 * Circuit Breaker — Prevents cascading failures
 */
import type { VisionFailure } from '../config/types.js'

interface CircuitState {
  blockedUntil: number
  consecutiveFailures: number
  lastFailure: VisionFailure | null
}

/** Tuning knobs for the per-provider circuit breaker. */
export interface CircuitBreakerOptions {
  authTripTtlMs?: number
  defaultRateCooldownMs?: number
  maxEntries?: number
}

/**
 * Tracks per-provider failure states and trips the provider for a cooling
 * window so cascading failures cannot drain every fallback at once.
 */
export class VisionCircuitBreaker {
  private states = new Map<string, CircuitState>()
  private options: Required<CircuitBreakerOptions>

  constructor(options: CircuitBreakerOptions = {}) {
    this.options = {
      authTripTtlMs: options.authTripTtlMs ?? 10 * 60 * 1000,
      defaultRateCooldownMs: options.defaultRateCooldownMs ?? 60 * 1000,
      maxEntries: options.maxEntries ?? 128,
    }
  }

  /**
   * Whether a provider is currently tripped.
   * @param provider - the provider name to check.
   * @returns true while the provider's cooldown is active.
   */
  isBlocked(provider: string): boolean {
    const state = this.states.get(provider)
    if (!state) return false
    if (state.blockedUntil > Date.now()) return true
    this.states.delete(provider)
    return false
  }

  /**
   * Record an outcome for a provider, tripping it on failure.
   * @param provider - the provider name the outcome belongs to.
   * @param result - `success` clears the state; a failure sets the cooldown.
   */
  record(provider: string, result: 'success' | VisionFailure): void {
    if (result === 'success') {
      this.states.delete(provider)
      return
    }

    const ttlMs = this.getTtlForKind(result.kind)
    const blockedUntil = ttlMs > 0 ? Date.now() + ttlMs : 0

    const existing = this.states.get(provider)
    if (existing) {
      existing.blockedUntil = blockedUntil
      existing.consecutiveFailures += 1
      existing.lastFailure = result
    } else {
      this.states.set(provider, {
        blockedUntil,
        consecutiveFailures: 1,
        lastFailure: result,
      })
    }
  }

  /**
   * Milliseconds until a tripped provider becomes ready again.
   * @param provider - the provider name to query.
   * @returns the remaining cooldown in milliseconds, 0 when not tripped.
   */
  getTimeUntilReady(provider: string): number {
    const state = this.states.get(provider)
    if (!state || state.blockedUntil === 0) return 0
    return Math.max(0, state.blockedUntil - Date.now())
  }

  private getTtlForKind(kind: string): number {
    switch (kind) {
      case 'AUTH':
      case 'REGION':
      case 'TOS':
        return this.options.authTripTtlMs
      case 'RATE_LIMIT':
      case 'QUOTA':
        return this.options.defaultRateCooldownMs
      default:
        return Math.floor(this.options.defaultRateCooldownMs / 2)
    }
  }

  /** Forget every tracked provider state. */
  clear(): void {
    this.states.clear()
  }

  /**
   * Current breaker occupancy.
   * @returns the tripped provider names and the total tracked count.
   */
  stats(): { blocked: string[]; total: number } {
    const blocked = Array.from(this.states.entries())
      .filter(([, s]) => s.blockedUntil > Date.now())
      .map(([p]) => p)
    return { blocked, total: this.states.size }
  }
}

/**
 * Build a circuit breaker with the given tuning options.
 * @param options - cooldown and capacity knobs, all optional.
 * @returns a fresh breaker instance.
 */
export function createVisionCircuitBreaker(options?: CircuitBreakerOptions): VisionCircuitBreaker {
  return new VisionCircuitBreaker(options)
}
