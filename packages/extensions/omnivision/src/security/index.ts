/**
 * Security utilities — SSRF protection, path policy, credential redaction
 */
import { lookup } from 'node:dns/promises'
import { lstatSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'

/**
 * Check if IP is private or reserved
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
    if (first === 100 && second === 64) return true
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
 * Path policy — whitelist-based access control
 */
export class PathPolicy {
  private workspace: string
  private allowedDirs: Set<string>
  private tempDir: string

  constructor(workspace: string, options: { allowedDirs?: string[]; tempDir?: string } = {}) {
    this.workspace = resolve(workspace)
    this.allowedDirs = new Set((options.allowedDirs ?? []).map(d => resolve(d)))
    this.tempDir = options.tempDir ?? process.env.TEMP ?? '/tmp'
  }

  allowInput(path: string): boolean {
    const resolved = resolve(path)
    // Segment-level comparison: check each path component. isAbsolute guards
    // the Windows cross-drive case where relative() returns an absolute path
    // and would otherwise be misread as "inside" the allowed root.
    const checkPath = (allowed: string): boolean => {
      const rel = relative(allowed, resolved)
      return rel.length > 0 && !isAbsolute(rel) && !rel.startsWith('..') && !rel.startsWith('~')
    }
    return (
      checkPath(this.workspace) || checkPath(this.tempDir) || [...this.allowedDirs].some(checkPath)
    )
  }

  allowOutput(path: string): boolean {
    const resolved = resolve(path)
    const checkPath = (allowed: string): boolean => {
      const rel = relative(allowed, resolved)
      return rel.length > 0 && !isAbsolute(rel) && !rel.startsWith('..') && !rel.startsWith('~')
    }
    return checkPath(this.workspace) || checkPath(this.tempDir)
  }

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

  normalize(path: string): string {
    return resolve(path)
  }
}

/**
 * Three-layer credential redaction
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
  out = out.replace(/api[_-]?key["\s:=]+[a-zA-Z0-9_-]{20,}/gi, 'api_key=[REDACTED]')
  // Layer 3: URL userinfo
  out = out.replace(/(https?:\/\/)([^:@\s]+):([^@\s]+)(@)/g, '$1***:***$4')
  return out
}

/**
 * Redact URL credentials
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
