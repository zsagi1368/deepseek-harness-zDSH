/**
 * Media byte route `/workbench/file`: streams workspace files to the
 * browser for image/pdf/video-style previews and downloads. Same fence,
 * same guard, same caps as the JSON API — the only difference is that the
 * payload is raw bytes with a conservative content type.
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { ensureRealPathInside } from './path-guard.ts'
import type { RootCache } from './fs-routes.ts'
import { isTrustedRequestHost } from './trust.ts'

const MEDIA_LIMIT_BYTES = 200 * 1024 * 1024

const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml',
  avif: 'image/avif', pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm',
  txt: 'text/plain; charset=utf-8', md: 'text/plain; charset=utf-8',
}

/**
 * Create the media byte handler for `/workbench/file`. Same fence, guard, and
 * caps as the JSON API; the payload is raw bytes with a conservative content type.
 * @param rootCache - shared workspace-root cache used to resolve request cwds.
 * @param trustedHosts - deployment-configured host authorities allowed past the Host fence.
 * @param rootAllowed - optional deployment clamp on resolved workspace roots.
 * @returns the HTTP handler streaming the guarded file, or an error status.
 */
export function createMediaHandler(
  rootCache: RootCache,
  trustedHosts: readonly string[],
  rootAllowed?: (rootReal: string) => boolean,
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!isTrustedRequestHost(req.headers, trustedHosts)) {
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('forbidden')
      return
    }
    const url = new URL(req.url ?? '/', 'http://workbench.invalid')
    const cwd = url.searchParams.get('cwd') ?? ''
    const requested = url.searchParams.get('path') ?? ''
    const download = url.searchParams.get('download') === '1'

    const rootReal = typeof cwd === 'string' && cwd !== '' ? await rootCache.rootOf(cwd) : undefined
    if (typeof rootReal !== 'string' || requested === '') {
      res.writeHead(400, { 'content-type': 'text/plain' })
      res.end('bad request')
      return
    }
    if (rootAllowed !== undefined && !rootAllowed(rootReal)) {
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('outside workspace clamp')
      return
    }
    const verdict = await ensureRealPathInside(rootReal, requested)
    if (!verdict.allowed) {
      res.writeHead(403, { 'content-type': 'text/plain' })
      res.end('outside workspace')
      return
    }
    let size: number
    try {
      const stats = await stat(verdict.target)
      if (!stats.isFile()) {
        res.writeHead(400, { 'content-type': 'text/plain' })
        res.end('not a file')
        return
      }
      size = stats.size
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
      return
    }
    if (size > MEDIA_LIMIT_BYTES) {
      res.writeHead(413, { 'content-type': 'text/plain' })
      res.end('file too large')
      return
    }

    const ext = verdict.target.slice(verdict.target.lastIndexOf('.') + 1).toLowerCase()
    const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream'
    res.writeHead(200, {
      'content-type': contentType,
      'content-length': String(size),
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      ...(download ? { 'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileNameOf(verdict.target))}` } : {}),
    })
    const stream = createReadStream(verdict.target)
    stream.on('error', () => {
      // Headers are already out; all we can do is cut the socket cleanly.
      req.destroy()
    })
    stream.pipe(res)
  }
}

function fileNameOf(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index === -1 ? path : path.slice(index + 1)
}
