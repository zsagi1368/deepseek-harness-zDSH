/**
 * Git execution seam. Hard rules:
 * - argv arrays only, never a shell string;
 * - every path argument passes the workspace guard first;
 * - the runner NEVER sets or amends identity (no user.name/email anywhere);
 *   commits use whatever identity the repository itself carries;
 * - network operations (fetch/pull/push) live behind `confirm: true` and
 *   otherwise answer with a read-only preview instead of acting.
 */
import { spawn, spawnSync } from 'node:child_process'
// `win32` (not the host-bound `isAbsolute`): where.exe output is always a
// Windows path, so the validity check must be win32 semantics on every host —
// a POSIX `isAbsolute` would reject a valid `C:\...` path on Linux CI.
import { win32 } from 'node:path'
import type { RootCache } from './fs-routes.ts'
import { ensureRealPathInside } from './path-guard.ts'

/**
 * Resolve a bare executable name to an absolute path. Returns the first match
 * or null when the name cannot be found.
 */
export type BinaryResolver = (name: string) => string | null

/**
 * Platform default: `where.exe <name>` on Windows (a protected system binary
 * whose PATH is pinned under SystemRoot), `which <name>` on POSIX.
 * @param name - the executable name to resolve.
 * @returns the first absolute path found, or null when resolution fails.
 */
function defaultBinaryResolver(name: string): string | null {
  try {
    if (process.platform === 'win32') {
      const result = spawnSync('where.exe', [name], {
        encoding: 'utf8',
        // `where.exe` searches the current directory before PATH; pin the
        // probe to the neutral system root so a stray binary in the runner's
        // cwd can never shadow the PATH lookup.
        cwd: process.env.SystemRoot ?? process.env.WINDIR ?? undefined,
      })
      if (result.status === 0) {
        const resolved = firstLine(result.stdout)
        // `where.exe` echoes a bare name when the lookup misses; only an
        // absolute result is a usable binary path, so fail closed rather than
        // re-entering the PATH dependency this resolver exists to pin down.
        if (resolved !== null && win32.isAbsolute(resolved)) return resolved
      }
      return null
    }
    // `command` is a shell builtin with no standalone binary; `spawnSync`
    // cannot run it directly (ENOENT), so probe through the `which` utility.
    const result = spawnSync('which', [name], { encoding: 'utf8' })
    if (result.status === 0) return firstLine(result.stdout)
    return null
  } catch {
    return null
  }
}

function firstLine(stdout: string): string | null {
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (trimmed !== '') return trimmed
  }
  return null
}

/** One cached resolution: the value plus the wall-clock time it was stored. */
interface BinaryCacheEntry {
  value: string | null
  storedAt: number
}

/**
 * How long a resolved binary stays cached before the PATH lookup runs again.
 * Bounded so a binary installed/replaced at the same PATH slot is picked up
 * without paying for a probe on every call.
 */
const BINARY_CACHE_TTL_MS = 60_000

/**
 * Per-name cache so the PATH lookup runs at most once per TTL window. The
 * cache also drops wholesale when PATH changes, because every previously
 * resolved location may have moved.
 */
const binaryCache = new Map<string, BinaryCacheEntry>()

let currentResolver: BinaryResolver = defaultBinaryResolver
let lastPathValue: string | undefined = process.env.PATH

/**
 * Resolve an executable name through the active resolver with caching.
 * @param name - the executable name to resolve.
 * @returns the resolved absolute path, or null when unresolvable.
 */
export function resolveBinary(name: string): string | null {
  const now = Date.now()
  const pathNow = process.env.PATH
  if (pathNow !== lastPathValue) {
    // PATH changed: every previously resolved location may have moved.
    binaryCache.clear()
    lastPathValue = pathNow
  }
  const cached = binaryCache.get(name)
  if (cached !== undefined && now - cached.storedAt < BINARY_CACHE_TTL_MS) {
    return cached.value
  }
  const resolved = currentResolver(name)
  binaryCache.set(name, { value: resolved, storedAt: now })
  return resolved
}

/**
 * Replace the active binary resolver (test seam; clears the resolution cache).
 * @param resolver - the resolver to use for subsequent lookups.
 */
export function setBinaryResolver(resolver: BinaryResolver): void {
  currentResolver = resolver
  binaryCache.clear()
  lastPathValue = process.env.PATH
}

/**
 * Restore the platform-default resolver and clear the resolution cache.
 */
export function resetBinaryResolver(): void {
  currentResolver = defaultBinaryResolver
  binaryCache.clear()
  lastPathValue = process.env.PATH
}

/** One git process outcome: exit code plus captured stdout/stderr (byte-capped). */
export interface GitRunResult {
  code: number
  stdout: string
  stderr: string
}

/** Tuning knobs for one git invocation: timeout and output byte cap. */
export interface GitRunOptions {
  timeoutMs?: number
  maxOutputBytes?: number
}

const DEFAULT_TIMEOUT_MS = 30_000
/** Timeout granted to network operations (fetch/pull/push). */
const NETWORK_TIMEOUT_MS = 120_000
export { NETWORK_TIMEOUT_MS }
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

/**
 * Run one git command with argv only and a sanitized environment.
 * @param rootReal - the realpathed repository root used as the process cwd.
 * @param args - the git argv (validated by callers; never a shell string).
 * @param options - optional timeout and output byte cap overrides.
 * @returns the exit code plus captured stdout and stderr.
 */
export async function runGit(
  rootReal: string,
  args: string[],
  options: GitRunOptions = {},
): Promise<GitRunResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES
  return new Promise((resolve) => {
    // Never spawn a bare name: resolve `git` to an absolute path first and
    // fail closed (error result, not a degraded bare-name spawn) when the
    // PATH lookup comes up empty.
    const gitPath = resolveBinary('git')
    if (gitPath === null) {
      resolve({ code: -1, stdout: '', stderr: 'git: could not resolve the git executable on PATH' })
      return
    }
    const child = spawn(gitPath, args, {
      cwd: rootReal,
      shell: false,
      windowsHide: true,
      env: {
        // Minimal environment: keep PATH/SystemRoot so git finds its own
        // helpers, drop everything identity- or hook-injecting.
        PATH: process.env.PATH ?? '',
        SystemRoot: process.env.SystemRoot ?? '',
        HOME: process.env.HOME ?? process.env.UserProfile ?? '',
        LC_ALL: 'C',
        GIT_TERMINAL_PROMPT: '0',
        GIT_CONFIG_NOSYSTEM: '1',
      },
    })
    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, timeoutMs)
    if (typeof timer.unref === 'function') timer.unref()

    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.byteLength < maxBytes) stdout = Buffer.concat([stdout, chunk])
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.byteLength < maxBytes) stderr = Buffer.concat([stderr, chunk])
    })
    child.on('error', (cause) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout: '', stderr: cause.message })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        code: timedOut ? -2 : code ?? -1,
        stdout: stdout.toString('utf8'),
        stderr: timedOut ? 'git timed out' : stderr.toString('utf8'),
      })
    })
  })
}

/**
 * Guard one repo-relative-or-absolute path against the workspace root.
 * @param rootCache - shared workspace-root cache used to resolve the cwd.
 * @param cwd - the working directory whose root anchors the guard.
 * @param value - the path to guard (repo-relative or absolute).
 * @returns the real root and repo-relative path, or null when the path escapes.
 */
export async function guardRepoPath(
  rootCache: RootCache,
  cwd: unknown,
  value: unknown,
): Promise<{ rootReal: string; repoPath: string } | null> {
  if (typeof cwd !== 'string' || cwd === '' || typeof value !== 'string' || value === '') return null
  const rootReal = await rootCache.rootOf(cwd)
  if (typeof rootReal !== 'string') return null
  const verdict = await ensureRealPathInside(rootReal, value)
  if (!verdict.allowed) return null
  // Repo-relative form keeps git output stable across platforms.
  const repoPath = verdict.target.startsWith(rootReal)
    ? verdict.target.slice(rootReal.length).replace(/^[\\/]/, '')
    : value
  return { rootReal, repoPath }
}

// ── Named operations ───────────────────────────────────────────────────────
// Every process invocation lives HERE, behind fixed argument prefixes built
// from constants; callers pass only fully validated values. Route modules
// orchestrate; they never assemble argv themselves.

const STATUS_ARGS = ['status', '--porcelain=v1', '-b', '--untracked-files=normal']
const BRANCHES_ARGS = ['branch', '--all', '--format=%(refname:short)%09%(objectname:short)']
const LOG_PRETTY = '%h%x1f%an%x1f%at%x1f%s'

/**
 * Run `git status --porcelain` with branch tracking.
 * @param rootReal - the realpathed repository root.
 * @returns the git run result.
 */
export async function opStatus(rootReal: string): Promise<GitRunResult> {
  return runGit(rootReal, [...STATUS_ARGS])
}

/**
 * Run `git remote -v`.
 * @param rootReal - the realpathed repository root.
 * @returns the git run result.
 */
export async function opRemotes(rootReal: string): Promise<GitRunResult> {
  return runGit(rootReal, ['remote', '-v'])
}

/**
 * Run `git branch --all` with short ref names.
 * @param rootReal - the realpathed repository root.
 * @returns the git run result.
 */
export async function opBranches(rootReal: string): Promise<GitRunResult> {
  return runGit(rootReal, [...BRANCHES_ARGS])
}

/**
 * Run a formatted `git log` limited to `limit` commits.
 * @param rootReal - the realpathed repository root.
 * @param limit - the maximum number of commits to request.
 * @returns the git run result.
 */
export async function opLog(rootReal: string, limit: number): Promise<GitRunResult> {
  return runGit(rootReal, ['log', '-n', String(limit), '--date-order', '--pretty=format:' + LOG_PRETTY])
}

/**
 * Run `git diff --no-color`, optionally scoped to one repo path.
 * @param rootReal - the realpathed repository root.
 * @param repoPath - optional repo-relative path to scope the diff.
 * @returns the git run result.
 */
export async function opDiff(rootReal: string, repoPath?: string): Promise<GitRunResult> {
  return runGit(rootReal, repoPath === undefined ? ['diff', '--no-color'] : ['diff', '--no-color', '--', repoPath])
}

/**
 * Run `git diff --cached --no-color`, optionally scoped to one repo path.
 * @param rootReal - the realpathed repository root.
 * @param repoPath - optional repo-relative path to scope the diff.
 * @returns the git run result.
 */
export async function opDiffCached(rootReal: string, repoPath?: string): Promise<GitRunResult> {
  return runGit(rootReal, repoPath === undefined ? ['diff', '--cached', '--no-color'] : ['diff', '--cached', '--no-color', '--', repoPath])
}

/**
 * Stage paths with `git add --`.
 * @param rootReal - the realpathed repository root.
 * @param repoPaths - the validated repo-relative paths to stage.
 * @returns the git run result.
 */
export async function opStage(rootReal: string, repoPaths: string[]): Promise<GitRunResult> {
  return runGit(rootReal, ['add', '--', ...repoPaths])
}

/**
 * Unstage paths with `git reset HEAD --`.
 * @param rootReal - the realpathed repository root.
 * @param repoPaths - the validated repo-relative paths to unstage.
 * @returns the git run result.
 */
export async function opUnstage(rootReal: string, repoPaths: string[]): Promise<GitRunResult> {
  return runGit(rootReal, ['reset', 'HEAD', '--', ...repoPaths])
}

/**
 * Commit with `git commit -m`.
 * @param rootReal - the realpathed repository root.
 * @param message - the validated commit message.
 * @returns the git run result.
 */
export async function opCommit(rootReal: string, message: string): Promise<GitRunResult> {
  return runGit(rootReal, ['commit', '-m', message])
}

/** Network git operation names; each one requires explicit user confirmation. */
export type NetworkAction = 'fetch' | 'pull' | 'push'

/**
 * Run one network operation with the network timeout.
 * @param rootReal - the realpathed repository root.
 * @param action - the network operation to run.
 * @param remote - the validated remote name.
 * @returns the git run result.
 */
export async function opNetwork(rootReal: string, action: NetworkAction, remote: string): Promise<GitRunResult> {
  const tail = action === 'push'
    ? [remote]
    : action === 'pull'
      ? ['--ff-only', remote]
      : [remote, '--prune']
  return runGit(rootReal, [action, ...tail], { timeoutMs: NETWORK_TIMEOUT_MS })
}
