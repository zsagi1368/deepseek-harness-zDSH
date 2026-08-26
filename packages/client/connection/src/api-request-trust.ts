/**
 * Browser-trust fence for every /api request. Defends the two confused-deputy
 * paths a browser opens against a local HTTP API — DNS rebinding (Host names
 * the attacker's domain while the socket reaches this server) and cross-site
 * requests fired from a malicious page. The Host fence binds every request,
 * browser-looking or not: over plain HTTP a browser attaches neither Origin
 * nor Fetch-Metadata to reads (images and navigations — those
 * headers go only to trustworthy destinations), so an unmarked request may
 * still be a rebound browser read and Host is the one header rebinding cannot
 * forge. Non-browser and remote clients pass the same fence via loopback,
 * deployment-derived LAN IP literals, or a declared `trustedHosts` authority.
 * Network reachability and authentication stay out of scope: binding policy
 * belongs to the webserver config, and this fence is not an auth layer.
 *
 * Rejections carry their reason (`apiTrustRejection`, surfaced as a
 * `forbidden (<reason>)` body and an `x-dsh-api-trust` header) so a locked-out
 * user can self-diagnose instead of blind-debugging extensions and proxies —
 * every real-world "403 via one loopback name" report was a header rewrite
 * between the browser and this server.
 */

import type { IncomingHttpHeaders } from 'node:http'
import { isLoopbackHostname } from './loopback-hostname.ts'

/** The request facts the fence reads from either HTTP representation. */
interface ApiTrustRequest {
  headers: IncomingHttpHeaders | Headers
}

function header(headers: IncomingHttpHeaders | Headers, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

/** Normalized URL of a Host-header authority (hostname lowercased, default port stripped, IPv6 bracketed), or undefined when unparsable. */
function parseAuthority(authority: string): URL | undefined {
  try {
    // http: is a WHATWG "special scheme": parsing yields a non-empty hostname or throws.
    return new URL(`http://${authority}`)
  } catch {
    return undefined
  }
}

/**
 * Assert one configured `trustedHosts` entry is a bare authority (`host` or
 * `host:port`) in canonical form: it must survive WHATWG parsing unchanged
 * (case aside). Anything parsing would silently rewrite is refused as a typo
 * that must fail the load loudly instead of being ignored until requests 403
 * or quietly changing the grant: URL parts beyond the authority
 * (`harness.internal/path`, `user@harness.internal` — which would authorize
 * the embedded hostname), stripped whitespace, a dangling colon or
 * zero-padded port (which would broaden an intended exact-port grant to every
 * port), and non-canonical host spellings (`0x7f.0.0.1`, percent-encoding,
 * unbracketed IPv6; IDN hosts are declared in punycode, the form the wire
 * carries).
 * @param entry - the configured value, verbatim.
 */
export function assertTrustedAuthority(entry: string): void {
  const entryUrl = parseAuthority(entry)
  if (entryUrl !== undefined && canonicalAuthority(entry, entryUrl) === entry.toLowerCase()) return
  throw new Error(`client-connection: trustedHosts entry ${JSON.stringify(entry)} is not a bare host[:port] authority`)
}

/**
 * Canonical form of a parsed authority: `hostname` when no port was written,
 * else `hostname:port`. The port is judged from URL parses under both special
 * schemes (their default ports differ, so `:80` and `:443` still count as
 * explicit), never from the raw string, where WHATWG trimming would misread
 * shapes like `host:port ` as port-less.
 */
function canonicalAuthority(entry: string, entryUrl: URL): string {
  // An authority that parsed under http cannot fail under https.
  const port = entryUrl.port !== '' ? entryUrl.port : new URL(`https://${entry}`).port
  return port === '' ? entryUrl.hostname : `${entryUrl.hostname}:${port}`
}

/**
 * Whether the request authority matches a `trustedHosts` entry. An entry with
 * an explicit port matches that exact authority; a port-less entry matches the
 * hostname on any port (the shape the CLI derives for IP-literal LAN serving,
 * where the bound port may be OS-assigned). Both sides compare through WHATWG
 * normalization, so case and a redundant `:80` never decide trust.
 */
function isTrustedAuthority(hostUrl: URL, trustedHosts: readonly string[]): boolean {
  return trustedHosts.some((entry) => {
    const entryUrl = parseAuthority(entry)
    if (entryUrl === undefined) return false
    return canonicalAuthority(entry, entryUrl) === entryUrl.hostname
      ? entryUrl.hostname === hostUrl.hostname
      : entryUrl.host === hostUrl.host
  })
}

/**
 * Why the fence refused one /api request. Surfaced to the caller (response
 * body and `x-dsh-api-trust` header) because a bare 403 turned every
 * header-rewriting extension or proxy on the user's machine into an
 * undebuggable lockout.
 */
export type ApiTrustRejection =
  | 'missing-host'
  | 'bad-host'
  | 'untrusted-host'
  | 'cross-site'
  | 'opaque-origin'
  | 'origin-mismatch'

/**
 * The forbidden response shape shared by every fetch-shaped fence call site.
 * @param reason - which fence condition refused the request.
 * @returns the 403 response carrying the reason in body and `x-dsh-api-trust` header.
 */
export function forbiddenResponse(reason: ApiTrustRejection): Response {
  return new Response('forbidden (' + reason + ')', {
    status: 403,
    headers: { 'x-dsh-api-trust': reason },
  })
}

/**
 * Decide whether one /api request may reach the RPC bridge, and when not, why.
 * @param request - Node HTTP or Fetch request facts (headers).
 * @param trustedHosts - non-loopback authorities this deployment serves: exact `host:port`, or port-less `host` matching any port.
 * @returns undefined when the Host is ours (loopback or trusted) and any
 * attached browser markers are same-origin; otherwise the refusal reason.
 */
export function apiTrustRejection(request: ApiTrustRequest, trustedHosts: readonly string[]): ApiTrustRejection | undefined {
  // Host fence (DNS-rebinding defense), applied to every request: the browser
  // fills Host from the URL it believes it is talking to, so a rebound page
  // carries the attacker's domain here even though the socket lands on this
  // server. There is no marker shortcut — a browser read over plain HTTP
  // (images and navigations) arrives with neither Origin nor
  // Fetch-Metadata, indistinguishable from curl, and its response is readable
  // by the rebound page.
  const host = header(request.headers, 'host')
  if (host === undefined) return 'missing-host'
  const hostUrl = parseAuthority(host)
  if (hostUrl === undefined) return 'bad-host'
  if (!isLoopbackHostname(hostUrl.hostname) && !isTrustedAuthority(hostUrl, trustedHosts)) return 'untrusted-host'
  // Cross-site fence: modern browsers label the initiator relationship on
  // every fetch; an explicit cross-site marker is refused regardless of Origin.
  if (header(request.headers, 'sec-fetch-site') === 'cross-site') return 'cross-site'
  // Origin fence: when a browser attaches an Origin it must name this server.
  // Absent Origin is fine — the Host fence above already bound the request.
  // The literal "null" (sandboxed iframes, file: pages) is an opaque origin,
  // refused, as is anything that fails URL parsing or does not name an http(s)
  // authority. A loopback Host accepts any loopback-flavor Origin (localhost /
  // 127.0.0.1 / [::1], any port): those spellings are one trust domain to the
  // Host fence above, so splitting them here only rejected rewritten headers
  // from extensions and proxies sitting between the browser and this server.
  // Non-loopback authorities keep the exact host:port equality — on the LAN
  // the port is part of who is talking.
  const origin = header(request.headers, 'origin')
  if (origin === undefined) return undefined
  let originUrl: URL
  try {
    originUrl = new URL(origin)
  } catch {
    return 'opaque-origin'
  }
  if (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') return 'opaque-origin'
  if (originUrl.host === hostUrl.host) return undefined
  if (isLoopbackHostname(hostUrl.hostname) && isLoopbackHostname(originUrl.hostname)) return undefined
  return 'origin-mismatch'
}

/**
 * Decide whether one /api request may reach the RPC bridge.
 * @param request - Node HTTP or Fetch request facts (headers).
 * @param trustedHosts - non-loopback authorities this deployment serves: exact `host:port`, or port-less `host` matching any port.
 * @returns true when the Host is ours (loopback or trusted) and any attached browser markers are same-origin.
 */
export function isTrustedApiRequest(request: ApiTrustRequest, trustedHosts: readonly string[]): boolean {
  return apiTrustRejection(request, trustedHosts) === undefined
}
