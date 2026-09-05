/**
 * Address-bar guard for the sandboxed browser panel. Rules enforced BEFORE
 * anything is placed into an iframe:
 * - absolute http(s) URLs only;
 * - javascript:, data:, file:, blob:, about: etc. are refused outright;
 * - loopback, link-local, private-range and .local hostnames are refused by
 *   default: this panel is a web-surfing tool, not an internal-network
 *   probe (the workbench's own pages are reached through DSH itself);
 * - the decision is pure so tests cover every branch.
 */

const PRIVATE_HOST_PATTERNS: ReadonlyArray<RegExp> = [
  /^localhost$/i,
  /\.local$/i,
  /^127\./,
  /^0\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^\[?::1\]?$/,
  /^\[?fe80/i,
  /^\[?fc/i,
  /^\[?fd/i,
]

/** Verdict of the address-bar guard: allowed target URL, or a refused result with a machine code. */
export type UrlGuardVerdict =
  | { allowed: true; url: string }
  | { allowed: false; code: 'bad-url' | 'scheme-refused' | 'host-refused'; message: string }

/**
 * Decide whether one address may be loaded in the sandboxed browser panel.
 * @param input - the raw address-bar value to judge.
 * @returns an `allowed` verdict with the normalized URL, or a refused verdict with code and message.
 */
export function judgeUrl(input: string): UrlGuardVerdict {
  const trimmed = input.trim()
  if (trimmed === '') return { allowed: false, code: 'bad-url', message: '请输入网址' }
  let parsed: URL
  try {
    // Absolute-with-scheme input parses as-is (about:, data:, javascript:…
    // must reach the scheme refusal, not be mangled into a search).
    parsed = new URL(trimmed)
  } catch {
    try {
      // Bare domains get an https suggestion instead of being paths.
      parsed = new URL(`https://${trimmed}`)
    } catch {
      return { allowed: false, code: 'bad-url', message: '无法解析该地址' }
    }
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { allowed: false, code: 'scheme-refused', message: `不允许的协议 ${parsed.protocol}` }
  }
  const hostname = parsed.hostname.toLowerCase()
  if (hostname === '' || PRIVATE_HOST_PATTERNS.some(pattern => pattern.test(hostname))) {
    return { allowed: false, code: 'host-refused', message: '内网与本机地址不可通过沙箱面板访问' }
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return { allowed: false, code: 'bad-url', message: '不支持带凭据的地址' }
  }
  return { allowed: true, url: parsed.toString() }
}
