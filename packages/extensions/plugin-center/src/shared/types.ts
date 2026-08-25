/** Stable error codes for every failure surface of the plugin center. */
export const CpErrorCode = {
  invalidPlan: 'invalid_plan',
  untrustedSource: 'untrusted_source',
  hashMismatch: 'hash_mismatch',
  backupFailed: 'backup_failed',
  installFailed: 'install_failed',
  healthCheckFailed: 'health_check_failed',
  rollbackFailed: 'rollback_failed',
  planConsumed: 'plan_consumed',
  planNotFound: 'plan_not_found',
  confirmationMismatch: 'confirmation_mismatch',
  scriptBlocked: 'script_blocked',
  sourceUnreachable: 'source_unreachable',
  offlineDegraded: 'offline_degraded',
  unsafeUrl: 'unsafe_url',
  internal: 'internal',
} as const

/** The code values named in {@link CpErrorCode}. */
export type CpErrorCode = (typeof CpErrorCode)[keyof typeof CpErrorCode]

/** Closed result envelope used across every public surface. */
export type CpResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: CpErrorCode; message: string } }

/**
 * Wrap a value in the success variant of the result envelope.
 * @param data - the payload to carry.
 * @returns a success result.
 */
export function cpOk<T>(data: T): CpResult<T> {
  return { ok: true, data }
}

/**
 * Build the failure variant of the result envelope.
 * @param code - the stable error code.
 * @param message - the human-readable failure detail.
 * @returns a failure result.
 */
export function cpErr<T = never>(
  code: CpErrorCode,
  message: string,
): CpResult<T> {
  return { ok: false, error: { code, message } }
}

/**
 * Normalize a plugin id to the canonical `namespace/name` form.
 * Accepts `@scope/pkg`, `owner/repo` and bare names; rejects empties and any
 * character outside the safe identifier set (ids flow into command argv).
 * @param raw - the plugin id to normalize.
 * @returns the canonical `namespace/name` form, or an error result.
 */
export function normalizePluginId(raw: string): CpResult<string> {
  const trimmed = raw.trim().replace(/^@/, '')
  if (!trimmed) return cpErr(CpErrorCode.invalidPlan, 'empty plugin id')
  if (trimmed.length > 120) return cpErr(CpErrorCode.invalidPlan, 'plugin id too long')
  const parts = trimmed.split('/').filter(Boolean)
  if (parts.length === 0 || parts.length > 2) {
    return cpErr(CpErrorCode.invalidPlan, `malformed plugin id: ${raw}`)
  }
  for (const part of parts) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part)) {
      return cpErr(CpErrorCode.invalidPlan, `illegal characters in plugin id segment: ${part.slice(0, 30)}`)
    }
  }
  return cpOk(parts.join('/'))
}

/** Lifecycle states of a plan as it moves through the engine. */
export type PlanState =
  | 'draft'
  | 'planned'
  | 'confirmed'
  | 'executing'
  | 'applied'
  | 'rolled-back'
  | 'restart-pending'

/** How an audit entry resolved: success, error, or rolled back. */
export type AuditOutcome = 'ok' | 'error' | 'rolled-back'

/** One append-only audit log entry describing an engine step. */
export interface AuditEvent {
  ts: string
  action: string
  planId?: string
  step?: string
  outcome: AuditOutcome
  errorCode?: string
  detail?: Record<string, string | number | boolean>
}
