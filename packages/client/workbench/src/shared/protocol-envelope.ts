/**
 * The one response envelope for every `/workbench/api/*` route. Success and
 * failure are both JSON objects on HTTP 200/4xx; `code` values come from the
 * closed vocabulary each domain declares so clients can branch on them.
 */
export type WorkbenchRouteEnvelope<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }

/**
 * Wrap a value into the success envelope.
 * @param value - the payload to carry.
 * @returns the `{ ok: true, value }` envelope.
 */
export function envelopeOk<T>(value: T): WorkbenchRouteEnvelope<T> {
  return { ok: true, value }
}

/**
 * Wrap an error into the failure envelope.
 * @param code - the stable machine-readable error code.
 * @param message - the human-readable error message.
 * @returns the `{ ok: false, error }` envelope.
 */
export function envelopeFail(code: string, message: string): WorkbenchRouteEnvelope<never> {
  return { ok: false, error: { code, message } }
}

/** Well-known codes shared across domains. */
export const ENVELOPE_CODES = {
  untrustedHost: 'untrusted-host',
  noRoute: 'no-route',
  badRequest: 'bad-request',
  notFound: 'not-found',
  outsideWorkspace: 'outside-workspace',
  tooLarge: 'too-large',
} as const
