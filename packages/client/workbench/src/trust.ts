/**
 * Browser-trust fence for every /workbench route. Mirrors the semantics the
 * host's own `/api` gateway applies, because a plugin route is exactly as
 * reachable by a browser and must not become the weaker sibling of the two
 * doors into the same process. Two confused-deputy paths are covered:
 *
 * - DNS rebinding: an attacker's domain resolving to 127.0.0.1 while the
 *   socket reaches this server. The Host header cannot be forged by a
 *   rebound browser (the socket target does not change what the browser
 *   sends), so binding every request to a Host check closes the path.
 * - Cross-site requests from a malicious page: over plain HTTP such requests
 *   carry neither Origin nor Fetch-Metadata on reads, so Host remains the
 *   one reliable discriminator.
 *
 * A request passes when its Host authority is a loopback hostname, or when
 * its canonical `host[:port]` form appears in the deployment-configured
 * trusted set. This fence is NOT an authentication layer; bind policy stays
 * with the webserver configuration.
 */
import type { IncomingHttpHeaders } from 'node:http'

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

/** Parse one authority string into its hostname/port parts, or undefined when unparsable. */
function parseAuthority(authority: string): { hostname: string; explicitPort: boolean } | undefined {
  try {
    // http: is a WHATWG special scheme, so parsing yields a non-empty
    // hostname or throws — bare tokens like `not a host` never slip through.
    const parsed = new URL(`http://${authority}`)
    // Judge explicit ports under https too: default ports differ between the
    // special schemes, so an entry written as `host:80` stays explicit.
    const httpsPort = new URL(`https://${authority}`).port
    return { hostname: parsed.hostname, explicitPort: parsed.port !== '' || httpsPort !== '' }
  } catch {
    return undefined
  }
}

/** Canonical `hostname` or `hostname:port` form of a configured entry. */
function canonicalAuthority(entry: string): string | undefined {
  const parts = parseAuthority(entry)
  if (parts === undefined) return undefined
  return parts.explicitPort ? normalizeWithPort(entry) : parts.hostname
}

function normalizeWithPort(entry: string): string {
  const parsed = new URL(`http://${entry}`)
  return `${parsed.hostname}:${parsed.port}`
}

/**
 * Validate one configured trusted-hosts entry at load time: it must be a
 * bare `host[:port]` authority that survives canonical parsing unchanged
 * (case aside). Paths, user info, whitespace, dangling or zero-padded ports,
 * and non-canonical host spellings are refused loudly instead of silently
 * narrowing (or broadening) the grant until some request 403s.
 * @param entry - the configured `host[:port]` authority to validate.
 */
export function assertTrustedAuthorityEntry(entry: string): void {
  const canonical = canonicalAuthority(entry)
  if (canonical !== undefined && canonical === entry.toLowerCase()) return
  throw new Error(`workbench: trustedHosts entry ${JSON.stringify(entry)} is not a bare host[:port] authority`)
}

/**
 * Decide whether a request may proceed from its headers alone. The Host
 * header binds the decision: loopback hostnames pass regardless of port;
 * anything else must match one configured authority in exact canonical form.
 * @param headers - the request headers whose Host value binds the decision.
 * @param trustedEntries - the deployment-configured trusted authorities.
 * @returns true when the request host is loopback or in the trusted set.
 */
export function isTrustedRequestHost(headers: IncomingHttpHeaders, trustedEntries: readonly string[]): boolean {
  const host = headers.host
  if (typeof host !== 'string' || host.length === 0) return false
  const parts = parseAuthority(host)
  if (parts === undefined) return false
  if (LOOPBACK_HOSTNAMES.has(parts.hostname)) return true
  if (trustedEntries.length === 0) return false
  const requested = canonicalAuthority(host)
  if (requested === undefined) return false
  return trustedEntries.some(entry => canonicalAuthority(entry) === requested)
}
