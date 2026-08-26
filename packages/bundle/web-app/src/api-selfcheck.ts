/**
 * The startup /api self-check. After the URL line prints, the process probes
 * its own server once through the exact address it just advertised, so the
 * S-24 lockout shape — the page loads but every API call 403s, and the
 * operator spends an hour blaming the printed address — announces itself at
 * boot instead. A refusal here is never the fence working as intended: the
 * probe's Host is the printed loopback authority, always trusted, so a 403
 * means something between this process and its own socket (local proxy, VPN,
 * security software) rewrote the request — the same interference the browser
 * is about to hit. The outcome maps onto the diagnostic rejection contract of
 * the /api browser-trust fence: the 403 body reads `forbidden (<reason>)` and
 * the `x-dsh-api-trust` header carries that reason, so the boot guidance
 * teaches the format the user will see again in the browser.
 * @module @deepseek-ai/dsh-web-app/api-selfcheck
 */

/** The /api path probed: answered by the route itself (426 upgrade-required) without touching the RPC bridge or any session state. */
const SELF_CHECK_PATH = '/api/events.mux'

/** Header carrying the fence's refusal reason on a 403. */
const TRUST_REASON_HEADER = 'x-dsh-api-trust'

/** How long the probe waits before declaring the address unreachable. */
export const API_SELF_CHECK_TIMEOUT_MS = 5000

/** How the one-shot self-probe ended. */
export type ApiSelfCheckOutcome =
  /** The server answered with something other than a fence rejection; the fence let our own request through. */
  | { kind: 'ok'; status: number }
  /** The fence refused the probe's own loopback request; `reason` is the `x-dsh-api-trust` value when present. */
  | { kind: 'fenced'; reason: string | undefined }
  /** The request never completed: refused connection, timeout, redirect, or another fetch failure. */
  | { kind: 'unreachable'; detail: string }

/**
 * Classify one fetch failure for the unreachable outcome. Connection refusals
 * surface their errno code (`ECONNREFUSED`) because that is the string a
 * firewall or proxy report names; a timeout gets its own wording.
 * @param error - the fetch rejection reason.
 * @param timeoutMs - the timeout the probe used, for the timeout wording.
 * @returns a short detail string for the boot guidance line.
 */
function failureDetail(error: unknown, timeoutMs: number): string {
  if (error instanceof Error && error.name === 'TimeoutError') return `timed out after ${String(timeoutMs)}ms`
  const causeCode = (error as { cause?: { code?: unknown } }).cause?.code
  if (typeof causeCode === 'string') return causeCode
  return String(error)
}

/**
 * Probe this deployment's own /api surface through one printed base URL.
 * Markerless by construction — plain fetch attaches no Origin or
 * Fetch-Metadata, exactly the plain-HTTP read shape the fence judges by Host
 * alone. Never rejects: every failure mode lands in an outcome.
 * @param baseUrl - the printed Web URL (`http://127.0.0.1:<port>`).
 * @param timeoutMs - abort budget for the single request.
 * @returns how the probe ended, classified per {@link ApiSelfCheckOutcome}.
 * @throws RangeError when the base URL is not an http(s) URL — a caller bug,
 * since the printed address is always composed in-process.
 */
export async function probeApiSelfCheck(baseUrl: string, timeoutMs: number = API_SELF_CHECK_TIMEOUT_MS): Promise<ApiSelfCheckOutcome> {
  const probeUrl = new URL(SELF_CHECK_PATH, baseUrl)
  // Server-side requests stay http/https; the printed address is http today,
  // and anything else reaching here is a composition bug, not an outcome.
  if (probeUrl.protocol !== 'http:' && probeUrl.protocol !== 'https:') {
    throw new RangeError(`web-app: api self-check needs an http(s) base URL, got ${JSON.stringify(baseUrl)}`)
  }
  let response: Response
  try {
    response = await fetch(probeUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      // Our server never redirects /api paths; a redirect is interference and
      // must surface as unreachable rather than be followed off-machine.
      redirect: 'error',
    })
  } catch (error) {
    return { kind: 'unreachable', detail: failureDetail(error, timeoutMs) }
  }
  if (response.status === 403) return { kind: 'fenced', reason: response.headers.get(TRUST_REASON_HEADER) ?? undefined }
  return { kind: 'ok', status: response.status }
}

/**
 * Render the boot guidance for one self-check outcome. Quiet on success — a
 * healthy boot prints only its usual lines. Every problem line names the
 * remedies from the S-24 report: open the exact printed address, or declare
 * the authority you actually reach the server by with `--trusted-host`.
 * @param outcome - what the probe observed.
 * @param webUrl - the printed Web URL, quoted back to the operator.
 * @returns console lines to print (empty when the check passed).
 */
export function apiSelfCheckGuidance(outcome: ApiSelfCheckOutcome, webUrl: string): string[] {
  if (outcome.kind === 'ok') return []
  const prefix = 'dsh web:'
  if (outcome.kind === 'fenced') {
    const rejection = outcome.reason === undefined ? 'forbidden' : `forbidden (${outcome.reason})`
    return [
      `${prefix} the /api self-check was rejected with ${rejection} — even this process's own request to ${webUrl} was not trusted.`,
      `${prefix} the browser-trust fence saw a Host it does not recognize on a request that never left this machine; local proxy, VPN, or security software rewriting headers is the usual cause.`,
      `${prefix} open the printed address exactly as shown, or declare the authority you reach the server by with --trusted-host <host[:port]>; the x-dsh-api-trust response header (and the forbidden (<reason>) body) names the failed check.`,
    ]
  }
  return [
    `${prefix} the /api self-check could not reach ${new URL(SELF_CHECK_PATH, webUrl).toString()} (${outcome.detail}).`,
    `${prefix} the printed address may not be reachable from this machine; check firewall, proxy, or antivirus software intercepting loopback connections.`,
  ]
}
