/**
 * Deployment-level admission bounds for subagent delegation: the concurrency
 * gate shared by one-shot runs and continuable Activations, the typed
 * fast-failure it raises, and the limit-value vocabulary of the runtime config.
 *
 * The gate is deliberately a counter, never a queue: a start that would exceed
 * the limit rejects immediately with the current occupancy, so an unbounded
 * fan-out surfaces as a stream of clear errors instead of piling up children
 * that share one heap and one event loop with the host.
 *
 * @module @deepseek-ai/dsh-subagent/capacity
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { delegationDepthOf } from './depth.ts'
import { SubagentError } from './error.ts'

/**
 * Deployment limits for the subagent seam, settable as the runtime's plugin
 * config. Every key is optional; omitted keys take the documented default, and
 * unknown keys are rejected at construction instead of being ignored.
 */
export interface SubagentRuntimeConfig {
  /**
   * Maximum number of simultaneously admitted subagents across both delegation
   * shapes: one-shot runs hold a slot from `start()` admission until the run
   * settles; continuable children hold one from materialization until their
   * Activation leaves residency. A start that would exceed the limit rejects
   * immediately with `SubagentCapacityError` — the seam never queues. Default
   * `8`: enough fan-out for parallel delegation while bounding the heap and
   * event-loop share every in-process child costs. `'unlimited'` restores the
   * unbounded behavior.
   */
  maxConcurrent?: number | 'unlimited'
  /**
   * Absolute delegation-depth ceiling applied on top of any caller-supplied
   * `maxDepth` — the binding cap is the smaller of the two. A delegation whose
   * resolved child depth would exceed it fails fast with `SubagentDepthError`.
   * Default `3`, matching the model-facing tool's shipped default. A child that
   * cold-resumes after the ceiling was lowered stays reachable through
   * `followup`, but it cannot delegate deeper while its recorded depth already
   * meets the ceiling. `'unlimited'` disables the ceiling.
   */
  maxDepth?: number | 'unlimited'
}

/**
 * Typed failure for a start refused by the deployment concurrency limit. It is
 * a {@link SubagentError} with its own code so callers branch on the class
 * while generic seam handling (including the continuation manager's cold-resume
 * error folding) passes it through unwrapped.
 */
export class SubagentCapacityError extends SubagentError {
  /**
   * @param active - subagents already admitted when the refused start arrived.
   * @param limit - the configured concurrency limit.
   */
  constructor(
    public readonly active: number,
    public readonly limit: number,
  ) {
    super(
      `subagent concurrency limit reached: ${active} of ${limit} subagents are active; `
        + 'the start was refused, not queued — wait for running subagents to settle or raise maxConcurrent',
      'CAPACITY_EXCEEDED',
    )
    this.name = 'SubagentCapacityError'
  }
}

/**
 * One acquired concurrency slot. {@link release} is idempotent because a
 * slot's single release is guaranteed by different owners on different paths
 * (startup failure versus terminal settlement), and converging paths must not
 * double-count the return.
 */
export interface CapacityLease {
  /** Return the slot exactly once; later calls are no-ops. */
  release(): void
}

/**
 * Counting admission gate bounding how many subagents are simultaneously
 * admitted. One-shot runs hold a slot from `start()` admission until their
 * result settles; continuable children hold one from Activation materialization
 * until the Activation leaves residency (settlement, abort, teardown, or
 * rollback — every exit releases).
 */
export class SubagentConcurrencyGate {
  private active = 0

  /**
   * @param limit - maximum simultaneously admitted subagents; `undefined`
   *   admits without bound.
   */
  constructor(private readonly limit: number | undefined) {}

  /** Number of currently held slots.
   * @returns the live occupancy count. */
  get size(): number {
    return this.active
  }

  /**
   * Acquire one slot, or fail fast when the limit is full. Never waits.
   * @returns the lease whose `release()` returns the slot (idempotent).
   * @throws {SubagentCapacityError} when `limit` slots are already held.
   */
  acquire(): CapacityLease {
    if (this.limit !== undefined && this.active >= this.limit) {
      throw new SubagentCapacityError(this.active, this.limit)
    }
    this.active += 1
    let released = false
    return {
      release: () => {
        if (released) return
        released = true
        this.active -= 1
      },
    }
  }
}

/**
 * Validate one numeric-or-`'unlimited'` deployment limit value. Zero is legal:
 * it is a hard off-switch that refuses every start.
 * @param value - the configured value to validate.
 * @param label - config key naming the value in error messages.
 * @throws {TypeError} when the value is neither `undefined`, `'unlimited'`,
 *   nor a non-negative safe integer.
 */
export function assertSubagentLimitValue(value: unknown, label: string): void {
  if (value === undefined || value === 'unlimited') return
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw new TypeError(`${label} must be a non-negative safe integer or 'unlimited'`)
  }
}

/**
 * Read the delegating parent's durable delegation depth for ceiling checks.
 * Production Agents always expose both fields; a caller that carries neither
 * (a bare test double) has no comparable depth, so the deployment ceiling is
 * skipped rather than guessed — the provider's own per-request cap still
 * applies where it was supplied.
 * @param parent - the delegating parent agent.
 * @returns its non-negative safe-integer depth, or `undefined` when unreadable.
 */
export function readableParentDepth(parent: Agent): number | undefined {
  // The loose shape keeps the presence guard honest for bare test doubles,
  // which carry neither field; a real Agent always exposes both.
  const shape = parent as Partial<Pick<Agent, 'session' | 'options'>>
  if (shape.session === undefined || shape.options === undefined) return undefined
  return delegationDepthOf(parent)
}
