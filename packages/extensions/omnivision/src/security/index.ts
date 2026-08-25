/**
 * Security utilities — SSRF protection, path policy, credential redaction
 */
import { lookup } from 'node:dns/promises'
import { lstatSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, relative, resolve } from 'node:path'

/**
 * Check if IP is private or reserved
 * @param ip - the IP address to classify (IPv4 or IPv6).
 * @returns true when the address is private, loopback, link-local, or reserved.
 */
export function isPrivateOrReserved(ip: string): boolean {
  // IPv4-mapped IPv6 (e.g. ::ffff:10.0.0.5) must be judged by its embedded
  // IPv4 address, otherwise the mapped form bypasses the v4 ranges below.
  const unwrapped = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  if (/^\d+\.\d+\.\d+\.\d+$/.test(unwrapped)) {
    const parts = unwrapped.split('.').map(Number)
    const first = parts[0] ?? -1
    const second = parts[1] ?? -1
    if (first === 10) return true
    if (first === 172 && second >= 16 && second <= 31) return true
    if (first === 192 && second === 168) return true
    if (first === 127) return true
    if (first === 0) return true
    if (first === 169 && second === 254) return true
    // CGNAT (100.64.0.0/10): the full /10 spans 100.64 through 100.127.
    if (first === 100 && second >= 64 && second <= 127) return true
    if (first >= 224 && first <= 255) return true
  }
  if (
    ip.startsWith('::1') ||
    ip.startsWith('fe80:') ||
    ip.startsWith('fc') ||
    ip.startsWith('fd')
  ) {
    return true
  }
  return false
}

/**
 * Resolve hostname to IP and check if safe
 * @param url - the http(s) URL to resolve and validate.
 * @returns the resolved IP and the parsed URL when safe.
 * @throws an SSRF_* error when the protocol is unsupported, DNS fails, or the
 *   resolved address is private or reserved.
 */
export async function assertSafeRemoteTarget(url: string): Promise<{ ip: string; url: URL }> {
  const parsed = new URL(url)
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`SSRF_UNSUPPORTED_PROTOCOL: ${parsed.protocol}`)
  }
  let ip: string
  try {
    const result = await lookup(parsed.hostname)
    ip = result.address
  } catch {
    throw new Error('SSRF_DNS_FAILED')
  }
  if (isPrivateOrReserved(ip)) {
    throw new Error(`SSRF_PRIVATE_IP: ${ip}`)
  }
  return { ip, url: parsed }
}

/**
 * Whether `resolved` sits inside `root` (or is the root itself), compared at
 * path-segment boundaries — never a raw string prefix, so `/tmp` does not
 * admit `/tmpx`. Cross-drive and home-relative escapes read as outside.
 * @param resolved - the path to test, already resolved.
 * @param root - the allowed root directory.
 * @returns true when the resolved path sits inside the root or equals it.
 */
export function isPathWithinRoot(resolved: string, root: string): boolean {
  const rel = relative(root, resolved)
  return rel.length === 0 || (rel.length > 0 && !isAbsolute(rel) && !rel.startsWith('..') && !rel.startsWith('~'))
}

/**
 * Whether `resolved` sits inside any of the allowed roots.
 * @param resolved - the path to test, already resolved.
 * @param roots - the allowed root directories.
 * @returns true when at least one root contains the resolved path.
 */
export function isPathWithinRoots(resolved: string, roots: readonly string[]): boolean {
  return roots.some(root => isPathWithinRoot(resolved, root))
}

/**
 * Best-effort TOCTOU re-check of the final path component immediately before
 * opening it. Only regular files pass; symlinks, directories, and devices are
 * rejected. RESIDUAL RISK: the component can still be swapped between this
 * check and the actual open — closing that window needs openat-style relative
 * handles, which this codebase's provider layer does not use.
 * @param path - the path whose final component is probed.
 * @returns true when the final component exists and is a plain file.
 */
export function isPlainFileAt(path: string): boolean {
  try {
    return lstatSync(path).isFile()
  } catch {
    return false
  }
}

/**
 * Best-effort lstat probe of the FINAL path component: true only when it
 * exists and is a symbolic link. Unreadable or missing targets read as "not a
 * symlink" — the same ENOENT tolerance rejectSymlink applies.
 */
function isFinalSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * Path policy — whitelist-based access control
 */
export class PathPolicy {
  private workspace: string
  private allowedDirs: Set<string>
  private tempDir: string

  constructor(workspace: string, options: { allowedDirs?: string[]; tempDir?: string } = {}) {
    // Normalize all roots through realpathSync so symlink components in the
    // root paths are dereferenced before any containment check runs. This
    // makes both sides of every comparison live in canonical real-path space.
    this.workspace = this.canonicalize(resolve(workspace))
    this.allowedDirs = new Set((options.allowedDirs ?? []).map(d => this.canonicalize(resolve(d))))
    this.tempDir = this.canonicalize(options.tempDir ?? tmpdir())
  }

  /** realpathSync with ENOENT/EPERM fallback to the input path. */
  private canonicalize(p: string): string {
    try { return realpathSync(p) } catch { return p }
  }

  /** Canonicalize a candidate path before containment checks. */
  private canonical(path: string): string {
    return this.canonicalize(resolve(path))
  }

  /**
   * Whether `resolved` passes containment AND its fully-resolved real path
   * still sits inside an allowed root (R1-06 closed: both the candidate and
   * all roots are canonicalized through realpathSync in the constructor, so
   * symlink components are dereferenced before comparison). The final
   * component is additionally lstat-probed to reject a symlink planted at
   * the leaf. RESIDUAL RISK: TOCTOU between this check and open — closing
   * that needs O_NOFOLLOW/openat-style handles.
   * @param path - the candidate path to probe.
   * @returns true when the path passes containment and is not a final symlink.
   */
  allowInput(path: string): boolean {
    const resolved = this.canonical(path)
    return (
      (
        isPathWithinRoot(resolved, this.workspace)
        || isPathWithinRoot(resolved, this.tempDir)
        || [...this.allowedDirs].some(dir => isPathWithinRoot(resolved, dir))
      ) && !isFinalSymlink(resolved)
    )
  }

  /**
   * The resolved roots this policy admits inputs from (workspace + temp).
   * @returns the canonicalized allowed input roots.
   */
  inputRoots(): string[] {
    return [this.workspace, this.tempDir]
  }

  /**
   * Same canonical containment-plus-final-symlink discipline as {@link allowInput}.
   * @param path - the candidate path to probe.
   * @returns true when the path passes containment and is not a final symlink.
   */
  allowOutput(path: string): boolean {
    const resolved = this.canonical(path)
    return (
      (
        isPathWithinRoot(resolved, this.workspace) || isPathWithinRoot(resolved, this.tempDir)
      ) && !isFinalSymlink(resolved)
    )
  }

  /**
   * Reject a path whose final component is a symbolic link.
   * @param path - the path to inspect.
   * @throws an error tagged PATH_SYMLINK_DENIED when the final component is a symlink.
   */
  rejectSymlink(path: string): void {
    try {
      const stats = lstatSync(path)
      if (stats.isSymbolicLink()) {
        throw new Error(`PATH_SYMLINK_DENIED: Symbolic links not allowed: ${path}`)
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.message.includes('SYMLINK_DENIED')) {
        throw error
      }
    }
  }

  /**
   * Resolve a path to its absolute form.
   * @param path - the path to normalize.
   * @returns the resolved absolute path.
   */
  normalize(path: string): string {
    return resolve(path)
  }
}

/**
 * Three-layer credential redaction
 * @param text - the text to redact credentials from.
 * @param knownSecrets - known secret values to mask by exact match.
 * @returns the text with credential material replaced by markers.
 */
export function redactSecrets(text: string, knownSecrets: string[] = []): string {
  let out = text
  // Layer 1: Exact match for known secrets
  for (const secret of knownSecrets) {
    if (secret.length > 3) {
      out = out.split(secret).join('[REDACTED]')
    }
  }
  // Layer 2: Token shape regex
  out = out.replace(/(?:sk-|pk-)[a-zA-Z0-9_-]{20,}/g, '[REDACTED_KEY]')
  out = out.replace(/Bearer\s+[a-zA-Z0-9._-]{20,}/g, 'Bearer [REDACTED]')
  out = out.replace(/api[_-]?key["\s:=]+[a-z0-9_-]{20,}/gi, 'api_key=[REDACTED]')
  // Layer 3: URL userinfo
  out = out.replace(/(https?:\/\/)([^:@\s]+):([^@\s]+)(@)/g, '$1***:***$4')
  return out
}

/**
 * Redact URL credentials
 * @param url - the URL whose userinfo is redacted.
 * @returns the URL with username and password masked, or the input when unparseable.
 */
export function redactUrl(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.username || parsed.password) {
      parsed.username = '***'
      parsed.password = '***'
      return parsed.toString()
    }
  } catch {
    // Invalid URL
  }
  return url
}

/**
 * Get a list of currently set API keys for redaction
 * @returns the non-empty API key values from the well-known environment variables.
 */
export function getKnownSecrets(): string[] {
  const secrets: string[] = []
  const keyNames = ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'ZAI_API_KEY']
  for (const name of keyNames) {
    const value = process.env[name]
    if (value && value.length > 10) {
      secrets.push(value)
    }
  }
  return secrets
}
