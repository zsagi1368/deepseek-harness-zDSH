/**
 * Git route handlers behind `/workbench/api/git.*`. All process work is
 * delegated to named operations in git-runner.ts (fixed argument prefixes,
 * validated values, no shell, no identity writes). Network operations run
 * only with explicit confirmation; without it they answer a read-only
 * preview so the client can show what WOULD happen.
 */
import { envelopeFail, envelopeOk } from './shared/protocol-envelope.ts'
import type { WorkbenchRouteEnvelope } from './shared/protocol-envelope.ts'
import {
  guardRepoPath,
  NETWORK_TIMEOUT_MS,
  opBranches,
  opCommit,
  opDiff,
  opDiffCached,
  opLog,
  opNetwork,
  opRemotes,
  opStage,
  opStatus,
  opUnstage,
} from './git-runner.ts'
import type { GitRunResult } from './git-runner.ts'
import type { RootCache } from './fs-routes.ts'
import { ensureRealPathInside } from './path-guard.ts'

/** Dependencies routed into the git handlers: the shared root cache and optional deployment clamp. */
export interface GitRouteDeps {
  rootCache: RootCache
  /** Deployment clamp shared with the fs routes. */
  rootAllowed?: (rootReal: string) => boolean
}

type Handler = (payload: unknown) => Promise<WorkbenchRouteEnvelope<unknown>>

function asObject(payload: unknown): Record<string, unknown> {
  return (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
}

function fail(code: string, stderr: string): WorkbenchRouteEnvelope<never> {
  const trimmed = stderr.trim() || 'git command failed'
  return { ok: false, error: { code, message: trimmed } }
}

function failResult(result: GitRunResult): WorkbenchRouteEnvelope<never> {
  // Exit code 128 covers "not a git repository" and other fatal usage errors.
  return fail(result.code === 128 ? 'not-a-repository' : 'git-error', result.stderr)
}

async function requireRoot(
  rootCache: RootCache,
  cwd: unknown,
  rootAllowed?: (rootReal: string) => boolean,
): Promise<{ rootReal: string } | WorkbenchRouteEnvelope<never>> {
  if (typeof cwd !== 'string' || cwd === '') return envelopeFail('bad-request', 'cwd is required')
  const rootReal = await rootCache.rootOf(cwd)
  if (typeof rootReal !== 'string') return envelopeFail('bad-request', 'cwd is not an existing directory')
  if (rootAllowed !== undefined && !rootAllowed(rootReal)) {
    return envelopeFail('outside-workspace', 'cwd is outside the deployment workspace clamp')
  }
  const inside = await ensureRealPathInside(rootReal, cwd)
  if (!inside.allowed) return envelopeFail(inside.code, inside.message)
  return { rootReal }
}

async function sanitizeRepoPath(rootReal: string, value: string): Promise<string | null> {
  if (value === '') return null
  // Status output yields repo-relative paths; resolve lexically against the
  // root and re-run the guard so nothing outside can sneak through.
  const resolved = rootReal.replace(/[\\/]+$/, '') + '/' + value.replace(/^[\\/]/, '')
  const verdict = await ensureRealPathInside(rootReal, resolved)
  return verdict.allowed ? verdict.target.slice(rootReal.length + 1).replace(/^[\\/]/, '') : null
}

async function guardAllPaths(
  rootCache: RootCache,
  payload: Record<string, unknown>,
  rootAllowed?: (rootReal: string) => boolean,
): Promise<{ rootReal: string; repoPaths: string[] } | WorkbenchRouteEnvelope<never>> {
  const raw = payload.paths
  const paths = Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string') : []
  if (paths.length === 0) return envelopeFail('bad-request', 'paths array is required')
  const rootReal0 = await requireRoot(rootCache, payload.cwd, rootAllowed)
  if (!('rootReal' in rootReal0)) return rootReal0
  const repoPaths: string[] = []
  for (const path of paths) {
    const verdict = await guardRepoPath(rootCache, payload.cwd, path)
    if (verdict === null) return envelopeFail('outside-workspace', 'a path escapes the workspace')
    repoPaths.push(verdict.repoPath)
  }
  return { rootReal: rootReal0.rootReal, repoPaths }
}

/**
 * Build the `/workbench/api/git.*` handler map. All process work is delegated
 * to named operations in git-runner.ts.
 * @param deps - root cache plus optional deployment clamp.
 * @returns the route method → handler map (all handlers return envelope values).
 */
export function createGitHandlers(deps: GitRouteDeps): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  const rootCache = deps.rootCache
  const rootAllowed = deps.rootAllowed

  handlers.set('git.status', async (raw) => {
    const payload = asObject(raw)
    const root = await requireRoot(rootCache, payload.cwd, rootAllowed)
    if (!('rootReal' in root)) return root
    const result = await opStatus(root.rootReal)
    if (result.code !== 0) return failResult(result)
    const lines = result.stdout.split('\n').filter(line => line !== '')
    let branch = ''
    let ahead = 0
    let behind = 0
    const entries: Array<{ path: string; x: string; y: string; untracked: boolean }> = []
    for (const line of lines) {
      if (line.startsWith('## ')) {
        const body = line.slice(3)
        const bracketIndex = body.indexOf('[')
        branch = (bracketIndex === -1 ? body : body.slice(0, bracketIndex)).replace(/\.\.\..*$/, '').trim()
        const trackPart = bracketIndex === -1 ? '' : body.slice(bracketIndex)
        const aheadMatch = /ahead (\d+)/.exec(trackPart)
        const behindMatch = /behind (\d+)/.exec(trackPart)
        ahead = aheadMatch !== null ? Number(aheadMatch[1]) : 0
        behind = behindMatch !== null ? Number(behindMatch[1]) : 0
        continue
      }
      entries.push({
        path: line.slice(3),
        x: line.charAt(0),
        y: line.charAt(1),
        untracked: line.charAt(0) === '?' && line.charAt(1) === '?',
      })
    }
    return envelopeOk({ branch, ahead, behind, entries })
  })

  handlers.set('git.diff', async (raw) => {
    const payload = asObject(raw)
    const root = await requireRoot(rootCache, payload.cwd, rootAllowed)
    if (!('rootReal' in root)) return root
    const repoPath = typeof payload.path === 'string' && payload.path !== ''
      ? await sanitizeRepoPath(root.rootReal, payload.path)
      : undefined
    if (repoPath === null) return envelopeFail('outside-workspace', 'path escapes the workspace')
    const result = await opDiff(root.rootReal, repoPath)
    if (result.code !== 0) return failResult(result)
    return envelopeOk(result.stdout)
  })

  handlers.set('git.diffCached', async (raw) => {
    const payload = asObject(raw)
    const root = await requireRoot(rootCache, payload.cwd, rootAllowed)
    if (!('rootReal' in root)) return root
    const repoPath = typeof payload.path === 'string' && payload.path !== ''
      ? await sanitizeRepoPath(root.rootReal, payload.path)
      : undefined
    if (repoPath === null) return envelopeFail('outside-workspace', 'path escapes the workspace')
    const result = await opDiffCached(root.rootReal, repoPath)
    if (result.code !== 0) return failResult(result)
    return envelopeOk(result.stdout)
  })

  handlers.set('git.log', async (raw) => {
    const payload = asObject(raw)
    const root = await requireRoot(rootCache, payload.cwd, rootAllowed)
    if (!('rootReal' in root)) return root
    const limit = typeof payload.limit === 'number' && payload.limit > 0 ? Math.min(Math.floor(payload.limit), 200) : 50
    const result = await opLog(root.rootReal, limit)
    if (result.code !== 0) return failResult(result)
    const commits = result.stdout.split('\n').filter(line => line !== '').map((line) => {
      const [hash, author, at, subject] = line.split('\x1f')
      return { hash: hash ?? '', author: author ?? '', at: Number(at ?? 0), subject: subject ?? '' }
    })
    return envelopeOk(commits)
  })

  handlers.set('git.branches', async (raw) => {
    const payload = asObject(raw)
    const root = await requireRoot(rootCache, payload.cwd, rootAllowed)
    if (!('rootReal' in root)) return root
    const result = await opBranches(root.rootReal)
    if (result.code !== 0) return failResult(result)
    const branches = result.stdout.split('\n').filter(line => line !== '').map((line) => {
      const [name, short] = line.split('\t')
      return { name: name?.trim() ?? '', hash: short?.trim() ?? '' }
    })
    return envelopeOk({ branches, current: branches.find(branch => !branch.name.startsWith('remotes/'))?.name ?? '' })
  })

  handlers.set('git.stage', async (raw) => {
    const payload = asObject(raw)
    const guarded = await guardAllPaths(rootCache, payload, rootAllowed)
    if (!('rootReal' in guarded)) return guarded
    const result = await opStage(guarded.rootReal, guarded.repoPaths)
    if (result.code !== 0) return failResult(result)
    return envelopeOk({ staged: guarded.repoPaths.length })
  })

  handlers.set('git.unstage', async (raw) => {
    const payload = asObject(raw)
    const guarded = await guardAllPaths(rootCache, payload, rootAllowed)
    if (!('rootReal' in guarded)) return guarded
    const result = await opUnstage(guarded.rootReal, guarded.repoPaths)
    if (result.code !== 0) return failResult(result)
    return envelopeOk({ unstaged: guarded.repoPaths.length })
  })

  handlers.set('git.commit', async (raw) => {
    const payload = asObject(raw)
    const message = typeof payload.message === 'string' ? payload.message.trim() : ''
    if (message === '') return envelopeFail('bad-request', 'commit message is required')
    const root = await requireRoot(rootCache, payload.cwd, rootAllowed)
    if (!('rootReal' in root)) return root
    const result = await opCommit(root.rootReal, message)
    if (result.code !== 0) return failResult(result)
    return envelopeOk({ committed: true })
  })

  const networkAction = (action: 'fetch' | 'pull' | 'push'): void => {
    handlers.set(`git.${action}`, async (raw) => {
      const payload = asObject(raw)
      const remoteRaw = typeof payload.remote === 'string' && payload.remote !== '' ? payload.remote : 'origin'
      // Remote names must be plain tokens before they may reach any spawn
      // seam; anything else is refused as input shape, never executed.
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(remoteRaw)) {
        return envelopeFail('bad-request', 'remote name has an unsupported shape')
      }
      const root = await requireRoot(rootCache, payload.cwd, rootAllowed)
      if (!('rootReal' in root)) return root
      if (payload.confirm !== true) {
        const remotes = await opRemotes(root.rootReal)
        const status = await opStatus(root.rootReal)
        const branchLine = status.stdout.split('\n').find(line => line.startsWith('## ')) ?? ''
        return envelopeOk({
          requiresConfirmation: true,
          action,
          remote: remoteRaw,
          remotes: remotes.stdout,
          tracking: branchLine.slice(3),
          timeoutMs: NETWORK_TIMEOUT_MS,
        })
      }
      const result = await opNetwork(root.rootReal, action, remoteRaw)
      if (result.code !== 0) {
        return fail(action === 'push' ? 'push-rejected' : 'git-network-error', result.stderr || result.stdout)
      }
      return envelopeOk({ done: true, output: result.stdout + result.stderr })
    })
  }

  networkAction('fetch')
  networkAction('pull')
  networkAction('push')

  return handlers
}
