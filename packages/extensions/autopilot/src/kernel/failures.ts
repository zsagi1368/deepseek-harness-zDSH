/**
 * Total-function treatment of failures.
 *
 * Every failure path in every module converges on the closed `FailureKind`
 * vocabulary and is mapped through ONE total table to a safe outcome. Nothing
 * may fall through implicitly: adding a FailureKind member breaks compilation
 * in every mapping table until it is handled.
 */
import type { FailureKind } from './types.js'

const FAILURE_KINDS: readonly FailureKind[] = [
  'timeout',
  'cancelled',
  'unavailable',
  'schema',
  'budget',
  'circuit-open',
]

/**
 * Whether the value is one of the closed `FailureKind` strings.
 * @param value - the value to test.
 * @returns true when it is a known failure kind.
 */
export function isFailureKind(value: unknown): value is FailureKind {
  return typeof value === 'string' && (FAILURE_KINDS as readonly string[]).includes(value)
}

/**
 * Exhaustiveness helper. Call inside a `default:` branch:
 *
 * ```ts
 * default: return assertUnreachable(kind);
 * ```
 *
 * If a new FailureKind member appears, every switch using this fails to
 * compile until handled.
 * @param value - the supposedly-exhausted value.
 * @param context - label used in the thrown error message.
 * @returns never — this function always throws.
 */
export function assertUnreachable(value: never, context = 'value'): never {
  throw new Error(`internal: unhandled ${context} ${JSON.stringify(String(value))}`)
}

/**
 * Map a failure through a caller-supplied total table. The table type forces a
 * decision for every failure kind — there is no implicit fallback.
 * @param kind - the failure kind to map.
 * @param table - one outcome per failure kind.
 * @returns the mapped safe outcome.
 */
export function toSafeOutcome<F>(kind: FailureKind, table: Record<FailureKind, F>): F {
  return table[kind]
}

/**
 * Cancelled failures are user-driven and never burn failure budgets.
 * @param kind - the failure kind to test.
 * @returns true when the kind is user-cancelled.
 */
export function isCancelled(kind: FailureKind): boolean {
  return kind === 'cancelled'
}

/**
 * Standard classification used by ledger accounting.
 * @param kind - the failure kind to test.
 * @returns true when the kind counts against the failure budget.
 */
export function countsAgainstFailureBudget(kind: FailureKind): boolean {
  return !isCancelled(kind)
}
