/**
 * Outbound-proxy resolution for the HTTP(S) fetch provider: an explicit
 * `proxyUrl` config always wins; otherwise well-known proxy environment
 * variables are consulted in a fixed order. Node's global fetch ignores proxy
 * environment variables entirely, so a resolved proxy is materialised as an
 * undici {@link ProxyAgent} and attached to each request as its dispatcher.
 *
 * Only plain `http://` proxy URLs are accepted: undici's ProxyAgent tunnels
 * `https://` targets over CONNECT through an http:// upstream, which covers the
 * standard corporate-proxy shape this config targets.
 *
 * @module @deepseek-ai/dsh-web-fetch-http/proxy
 */

import { ProxyAgent } from 'undici'

/**
 * Environment variables consulted when no explicit proxy URL is configured,
 * in precedence order: HTTPS first (the provider mostly fetches https://
 * targets), then HTTP, then the protocol-agnostic fallback. Within each group
 * the uppercase spelling wins so an explicit override beats an ambient default
 * on case-sensitive platforms.
 */
const PROXY_ENV_KEYS = [
  'HTTPS_PROXY',
  'https_proxy',
  'HTTP_PROXY',
  'http_proxy',
  'ALL_PROXY',
  'all_proxy',
] as const

/** Validate that `value` is a usable pure-`http://` proxy URL, returned unchanged. */
function assertHttpProxyUrl(value: string): string {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch (error: unknown) {
    throw new Error(`web-fetch-http: proxy URL "${value}" is not a valid URL`, { cause: error })
  }
  if (parsed.protocol !== 'http:') {
    throw new Error(`web-fetch-http: proxy URL "${value}" must use the http:// scheme`)
  }
  return value
}

/**
 * Resolve the effective proxy URL. An explicitly configured value wins and is
 * validated strictly (an invalid one throws at plugin construction); otherwise
 * the environment candidates are tried in order. An unusable environment entry
 * (empty or not a plain `http://` URL) is skipped rather than fatal — ambient
 * environment changes must not break plugin startup for deployments that
 * previously fetched directly.
 * @param configured - explicit `proxyUrl` from plugin config, when present.
 * @param env - environment map consulted for proxy variables; defaults to `process.env`.
 * @returns the effective proxy URL, or `undefined` when no proxy applies.
 */
export function resolveProxyUrl(
  configured: string | undefined,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  if (configured !== undefined) return assertHttpProxyUrl(configured)
  for (const key of PROXY_ENV_KEYS) {
    const value = env[key]?.trim()
    if (value === undefined || value === '') continue
    try {
      return assertHttpProxyUrl(value)
    } catch {
      // Skip unusable environment entries and keep consulting later candidates.
    }
  }
  return undefined
}

/**
 * Build the undici dispatcher injected into every proxied `fetch` call.
 * @param proxyUrl - validated plain-`http://` proxy URL to tunnel through.
 * @returns a `ProxyAgent` usable as a fetch request dispatcher.
 */
export function createProxyDispatcher(proxyUrl: string): ProxyAgent {
  return new ProxyAgent(proxyUrl)
}
