/**
 * The one response envelope for every `/workbench/api/*` route. Success and
 * failure are both JSON objects on HTTP 200/4xx; `code` values come from the
 * closed vocabulary each domain declares so clients can branch on them.
 */
export type WorkbenchRouteEnvelope<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: string; message: string } }

export function envelopeOk<T>(value: T): WorkbenchRouteEnvelope<T> {
  return { ok: true, value }
}

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
