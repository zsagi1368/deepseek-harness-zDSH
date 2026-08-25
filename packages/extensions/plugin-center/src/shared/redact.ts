const SENSITIVE_KEY =
  /(token|secret|password|passwd|credential|authorization|auth|api[-_]?key|^key$|cookie|session)/i

const JWT_LIKE = /^ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\./
const LONG_HEX = /^[0-9a-f]{32,}$/i

/** The replacement marker for redacted values. */
export const REDACTED = '[redacted]'

/**
 * Whether a value looks like a credential by shape (JWT or long hex).
 * @param value - the string to classify.
 * @returns true when the shape matches a token pattern.
 */
export function isSensitiveValue(value: string): boolean {
  return JWT_LIKE.test(value) || LONG_HEX.test(value)
}

/**
 * Redact a single value when its key or shape is credential-like.
 * @param key - the field name, matched against sensitive key patterns.
 * @param value - the string value to check.
 * @returns the redaction marker, or the value when safe.
 */
export function redactValue(key: string, value: string): string {
  if (SENSITIVE_KEY.test(key) || isSensitiveValue(value)) return REDACTED
  return value
}

/**
 * Shallow record redaction used by the audit trail before anything hits disk.
 * @param record - the flat or nested record to scrub.
 * @returns a copy with sensitive values replaced by the marker.
 */
export function redactRecord(
  record: Record<string, unknown>,
): Record<string, unknown> {
  const output: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (typeof value === 'string') {
      output[key] = redactValue(key, value)
    } else if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value)
    ) {
      output[key] = redactRecord(value as Record<string, unknown>)
    } else {
      output[key] = value
    }
  }
  return output
}
