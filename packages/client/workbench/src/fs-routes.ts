/**
 * Filesystem route handlers behind `/workbench/api/fs.*`. Every handler
 * follows the same discipline: validate the request shape, re-derive the
 * workspace root from the request's `cwd`, run the path guard against the
 * CURRENT filesystem, and only then touch disk. Client assertions about
 * containment are never trusted.
 */
import { mkdir, readdir, readFile, rename, rm, stat } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { dirname, join } from 'node:path'
import type { IncomingMessage } from 'node:http'
import {
  ensureRealPathInside,
  resolveWorkspaceRoot,
} from './path-guard.ts'
import { envelopeFail, envelopeOk } from './shared/protocol-envelope.ts'
import type { WorkbenchRouteEnvelope } from './shared/protocol-envelope.ts'
import type {
  FsDeleteResult,
  FsEntry,
  FsMkdirResult,
  FsReadResult,
  FsRenameResult,
  FsSearchMatch,
  FsSearchResult,
  FsTreeResult,
  FsWriteResult,
} from './shared/fs-protocol.ts'

/** Deployment-dependent limits and clamps for the fs route handlers. */
export interface FsRouteConfig {
  readLimitBytes: number
  listLimit: number
  searchLimit: number
  /** Deployment clamp: when set, a request's resolved cwd must pass. */
  rootAllowed?: (rootReal: string) => boolean
}

const READ_LIMIT_MAX = 8 * 1024 * 1024
const SEARCH_DEPTH_MAX = 12

const BINARY_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'avif', 'pdf', 'zip', 'gz',
  'tar', 'wasm', 'exe', 'dll', 'mp3', 'mp4', 'webm', 'woff', 'woff2', 'ttf',
  'otf', 'class', 'pyc', 'so', 'bin',
])

/** Bounded cache of workspace cwd → realpathed root, recomputed on overflow. */
export class RootCache {
  private readonly map = new Map<string, string>()
  constructor(private readonly capacity = 32) {}

  /**
   * Resolve (and cache) the realpathed workspace root for one cwd.
   * @param cwd - the working directory whose root to resolve.
   * @returns the real root path, or a failure marker when the cwd does not exist.
   */
  async rootOf(cwd: string): Promise<string | RootCacheFailure> {
    const cached = this.map.get(cwd)
    if (cached !== undefined) return cached
    try {
      const real = await resolveWorkspaceRoot(cwd)
      if (this.map.size >= this.capacity) {
        const oldest = this.map.keys().next().value
        if (typeof oldest === 'string') this.map.delete(oldest)
      }
      this.map.set(cwd, real)
      return real
    } catch {
      return { failed: true }
    }
  }
}

interface RootCacheFailure {
  failed: true
}

type Handler<T> = (payload: unknown) => Promise<WorkbenchRouteEnvelope<T>>

function asObject(payload: unknown): Record<string, unknown> {
  return (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
}

function requireString(value: unknown, field: string): string | WorkbenchRouteEnvelope<never> {
  if (typeof value !== 'string' || value.length === 0) {
    return envelopeFail('bad-request', `${field} is required`)
  }
  return value
}

function extOf(path: string): string {
  const dot = path.lastIndexOf('.')
  const base = path.lastIndexOf('/')
  const slash = path.lastIndexOf('\\')
  const nameStart = Math.max(base, slash)
  return dot > nameStart ? path.slice(dot + 1).toLowerCase() : ''
}

async function guardPath(
  config: FsRouteConfig,
  rootCache: RootCache,
  cwd: unknown,
  pathValue: unknown,
  field: string,
): Promise<{ cwdReal: string; target: string } | WorkbenchRouteEnvelope<never>> {
  const cwdCheck = requireString(cwd, 'cwd')
  if (typeof cwdCheck !== 'string') return cwdCheck
  const pathCheck = requireString(pathValue, field)
  if (typeof pathCheck !== 'string') return pathCheck
  const root = await rootCache.rootOf(cwdCheck)
  if (typeof root !== 'string') return envelopeFail('bad-request', 'cwd is not an existing directory')
  if (config.rootAllowed !== undefined && !config.rootAllowed(root)) {
    return envelopeFail('outside-workspace', 'cwd is outside the deployment workspace clamp')
  }
  const verdict = await ensureRealPathInside(root, pathCheck)
  if (!verdict.allowed) return envelopeFail(verdict.code, verdict.message)
  return { cwdReal: root, target: verdict.target }
}

async function readHead(path: string, bytes: number): Promise<Buffer> {
  const handle = await import('node:fs/promises').then(fs => fs.open(path, 'r'))
  try {
    const buffer = Buffer.alloc(bytes)
    const read = await handle.read(buffer, 0, bytes, 0)
    return buffer.subarray(0, read.bytesRead)
  } finally {
    await handle.close()
  }
}

function truncateUtf8(buffer: Buffer, maxBytes: number): { text: string; truncated: boolean; size: number } {
  let end = Math.min(buffer.byteLength, maxBytes)
  const truncatedFullFile = buffer.byteLength > maxBytes
  if (truncatedFullFile) {
    // Never split a multi-byte sequence: retreat to the leading byte of the
    // character the cap lands inside.
    while (end > 0 && ((buffer[end] ?? 0) & 0xc0) === 0x80) end -= 1
  }
  return { text: buffer.subarray(0, end).toString('utf8'), truncated: truncatedFullFile, size: buffer.byteLength }
}

/**
 * Build the `/workbench/api/fs.*` handler map for the given root cache and config.
 * @param rootCache - shared workspace-root cache used to resolve request cwds.
 * @param config - deployment limits and clamps for the handlers.
 * @returns the route method → handler map (all handlers return envelope values).
 */
export function createFsHandlers(rootCache: RootCache, config: FsRouteConfig): Map<string, Handler<unknown>> {
  const handlers = new Map<string, Handler<unknown>>()

  handlers.set('fs.tree', async (raw) => {
    const payload = asObject(raw)
    const guarded = await guardPath(config, rootCache, payload.cwd, payload.path, 'path')
    if (!('target' in guarded)) return guarded
    try {
      const dirents = await readdir(guarded.target, { withFileTypes: true })
      const entries: FsEntry[] = []
      let truncated = false
      for (const dirent of dirents) {
        if (entries.length >= config.listLimit) {
          truncated = true
          break
        }
        const entryPath = join(guarded.target, dirent.name)
        let broken = false
        let isDir = dirent.isDirectory()
        if (dirent.isSymbolicLink()) {
          try {
            const targetStats = await stat(entryPath)
            isDir = targetStats.isDirectory()
          } catch {
            broken = true
            isDir = false
          }
        }
        entries.push({ name: dirent.name, path: entryPath, isDir, isSymlink: dirent.isSymbolicLink(), broken })
      }
      entries.sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
        return a.name.localeCompare(b.name)
      })
      const result: FsTreeResult = { path: guarded.target, entries, truncated }
      return envelopeOk(result)
    } catch (cause) {
      return envelopeFail('not-found', cause instanceof Error ? cause.message : String(cause))
    }
  })

  handlers.set('fs.read', async (raw) => {
    const payload = asObject(raw)
    const guarded = await guardPath(config, rootCache, payload.cwd, payload.path, 'path')
    if (!('target' in guarded)) return guarded
    const requestedMax = typeof payload.maxBytes === 'number' && Number.isFinite(payload.maxBytes)
      ? Math.max(1, Math.floor(payload.maxBytes))
      : config.readLimitBytes
    const maxBytes = Math.min(requestedMax, READ_LIMIT_MAX)
    try {
      const stats = await stat(guarded.target)
      if (stats.isDirectory()) return envelopeFail('bad-request', 'path is a directory')
      const head = await readHead(guarded.target, 4096)
      const looksBinary = BINARY_EXTS.has(extOf(guarded.target)) || head.includes(0)
      if (looksBinary) {
        const result: FsReadResult = {
          kind: 'binary',
          size: stats.size,
          truncated: stats.size > head.byteLength,
          headBase64: head.toString('base64'),
        }
        return envelopeOk(result)
      }
      const full = await readFile(guarded.target)
      const sliced = truncateUtf8(full, maxBytes)
      const result: FsReadResult = { kind: 'text', content: sliced.text, truncated: sliced.truncated, size: sliced.size }
      return envelopeOk(result)
    } catch (cause) {
      return envelopeFail('not-found', cause instanceof Error ? cause.message : String(cause))
    }
  })

  handlers.set('fs.write', async (raw) => {
    const payload = asObject(raw)
    const guarded = await guardPath(config, rootCache, payload.cwd, payload.path, 'path')
    if (!('target' in guarded)) return guarded
    if (typeof payload.content !== 'string') return envelopeFail('bad-request', 'content must be a string')
    try {
      const parent = dirname(guarded.target)
      const parentVerdict = await ensureRealPathInside(guarded.cwdReal, parent)
      if (!parentVerdict.allowed) return envelopeFail(parentVerdict.code, parentVerdict.message)
      await mkdir(parent, { recursive: true })
      const existing = await stat(guarded.target).catch(() => undefined)
      if (existing?.isDirectory()) return envelopeFail('bad-request', 'target is a directory')
      const tmp = `${guarded.target}.zdsh-tmp-${Date.now()}-${randomBytes(4).toString('hex')}`
      await writeFile2(tmp, Buffer.from(payload.content, 'utf8'))
      try {
        await rename(tmp, guarded.target)
      } catch (renameError) {
        await rm(tmp, { force: true }).catch(() => {})
        throw renameError
      }
      const finalStats = await stat(guarded.target)
      const result: FsWriteResult = { saved: true, size: finalStats.size }
      return envelopeOk(result)
    } catch (cause) {
      return envelopeFail('io-error', cause instanceof Error ? cause.message : String(cause))
    }
  })

  handlers.set('fs.mkdir', async (raw) => {
    const payload = asObject(raw)
    const guarded = await guardPath(config, rootCache, payload.cwd, payload.path, 'path')
    if (!('target' in guarded)) return guarded
    try {
      await mkdir(guarded.target, { recursive: payload.recursive !== false })
      const result: FsMkdirResult = { created: true }
      return envelopeOk(result)
    } catch (cause) {
      return envelopeFail('io-error', cause instanceof Error ? cause.message : String(cause))
    }
  })

  handlers.set('fs.rename', async (raw) => {
    const payload = asObject(raw)
    const fromGuarded = await guardPath(config, rootCache, payload.cwd, payload.from, 'from')
    if (!('target' in fromGuarded)) return fromGuarded
    const toGuarded = await guardPath(config, rootCache, payload.cwd, payload.to, 'to')
    if (!('target' in toGuarded)) return toGuarded
    try {
      const existing = await stat(toGuarded.target).catch(() => undefined)
      if (existing?.isDirectory()) return envelopeFail('bad-request', 'destination is a directory')
      await rename(fromGuarded.target, toGuarded.target)
      const result: FsRenameResult = { moved: true }
      return envelopeOk(result)
    } catch (cause) {
      const code = (cause as NodeJS.ErrnoException).code === 'EXDEV' ? 'cross-device' : 'io-error'
      return envelopeFail(code, cause instanceof Error ? cause.message : String(cause))
    }
  })

  handlers.set('fs.delete', async (raw) => {
    const payload = asObject(raw)
    const guarded = await guardPath(config, rootCache, payload.cwd, payload.path, 'path')
    if (!('target' in guarded)) return guarded
    try {
      const stats = await stat(guarded.target)
      if (stats.isDirectory() && payload.recursive !== true) {
        return envelopeFail('is-directory', 'refusing to delete a directory without recursive')
      }
      await rm(guarded.target, { recursive: payload.recursive === true })
      const result: FsDeleteResult = { deleted: true }
      return envelopeOk(result)
    } catch (cause) {
      return envelopeFail('not-found', cause instanceof Error ? cause.message : String(cause))
    }
  })

  handlers.set('fs.search', async (raw) => {
    const payload = asObject(raw)
    const cwdCheck = requireString(payload.cwd, 'cwd')
    if (typeof cwdCheck !== 'string') return cwdCheck
    const query = typeof payload.query === 'string' ? payload.query.trim().toLowerCase() : ''
    if (query === '') return envelopeFail('bad-request', 'query is required')
    const root = await rootCache.rootOf(cwdCheck)
    if (typeof root !== 'string') return envelopeFail('bad-request', 'cwd is not an existing directory')
    if (config.rootAllowed !== undefined && !config.rootAllowed(root)) {
      return envelopeFail('outside-workspace', 'cwd is outside the deployment workspace clamp')
    }
    const startRaw = typeof payload.root === 'string' && payload.root !== '' ? payload.root : root
    const startVerdict = await ensureRealPathInside(root, startRaw)
    if (!startVerdict.allowed) return envelopeFail(startVerdict.code, startVerdict.message)

    const limit = typeof payload.limit === 'number' && payload.limit > 0
      ? Math.min(Math.floor(payload.limit), config.searchLimit)
      : config.searchLimit
    const needle = query.toLowerCase()
    const matches: FsSearchMatch[] = []
    let truncated = false
    let nextDepth: Array<{ dir: string; depth: number }> = [{ dir: startVerdict.target, depth: 0 }]
    while (nextDepth.length > 0 && !truncated) {
      const currentDepth = nextDepth
      nextDepth = []
      for (const { dir, depth } of currentDepth) {
        if (matches.length >= limit) {
          truncated = true
          break
        }
        let dirents
        try {
          dirents = await readdir(dir, { withFileTypes: true })
        } catch {
          continue
        }
        for (const dirent of dirents) {
          if (matches.length >= limit) {
            truncated = true
            break
          }
          const nameLower = dirent.name.toLowerCase()
          const childPath = join(dir, dirent.name)
          const skipBranch = dirent.isDirectory() && (dirent.name.startsWith('.') || nameLower === 'node_modules')
          if (nameLower.includes(needle)) {
            matches.push({ path: childPath, isDir: dirent.isDirectory() })
          }
          if (dirent.isDirectory() && !skipBranch && depth < SEARCH_DEPTH_MAX) {
            nextDepth.push({ dir: childPath, depth: depth + 1 })
          }
        }
      }
    }
    const result: FsSearchResult = { matches, truncated }
    return envelopeOk(result)
  })

  return handlers
}

async function writeFile2(path: string, data: Buffer): Promise<void> {
  const fs = await import('node:fs/promises')
  await fs.writeFile(path, data)
}

/**
 * Body reader shared by the router; enforces the configured byte cap.
 * @param req - the incoming request whose body to drain.
 * @param capBytes - hard byte cap; exceeding it throws 'body-too-large'.
 * @returns the concatenated request body.
 */
export async function readBody(req: IncomingMessage, capBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const piece = chunk as Buffer
    total += piece.byteLength
    if (total > capBytes) throw new Error('body-too-large')
    chunks.push(piece)
  }
  return Buffer.concat(chunks)
}
