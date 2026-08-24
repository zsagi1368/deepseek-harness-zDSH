/**
 * Git execution seam. Hard rules:
 * - argv arrays only, never a shell string;
 * - every path argument passes the workspace guard first;
 * - the runner NEVER sets or amends identity (no user.name/email anywhere);
 *   commits use whatever identity the repository itself carries;
 * - network operations (fetch/pull/push) live behind `confirm: true` and
 *   otherwise answer with a read-only preview instead of acting.
 */
import { spawn } from 'node:child_process'
import type { RootCache } from './fs-routes.ts'
import { ensureRealPathInside } from './path-guard.ts'

export interface GitRunResult {
  code: number
  stdout: string
  stderr: string
}

export interface GitRunOptions {
  timeoutMs?: number
  maxOutputBytes?: number
}

const DEFAULT_TIMEOUT_MS = 30_000
const NETWORK_TIMEOUT_MS = 120_000
export { NETWORK_TIMEOUT_MS }
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024

export async function runGit(
  rootReal: string,
  args: string[],
  options: GitRunOptions = {},
): Promise<GitRunResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxOutputBytes ?? MAX_OUTPUT_BYTES
  return new Promise((resolve) => {
    const child = spawn('git', args, {
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

/** Guard one repo-relative-or-absolute path against the workspace root. */
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

export async function opStatus(rootReal: string): Promise<GitRunResult> {
  return runGit(rootReal, [...STATUS_ARGS])
}

export async function opRemotes(rootReal: string): Promise<GitRunResult> {
  return runGit(rootReal, ['remote', '-v'])
}

export async function opBranches(rootReal: string): Promise<GitRunResult> {
  return runGit(rootReal, [...BRANCHES_ARGS])
}

export async function opLog(rootReal: string, limit: number): Promise<GitRunResult> {
  return runGit(rootReal, ['log', '-n', String(limit), '--date-order', '--pretty=format:' + LOG_PRETTY])
}

export async function opDiff(rootReal: string, repoPath?: string): Promise<GitRunResult> {
  return runGit(rootReal, repoPath === undefined ? ['diff', '--no-color'] : ['diff', '--no-color', '--', repoPath])
}

export async function opDiffCached(rootReal: string, repoPath?: string): Promise<GitRunResult> {
  return runGit(rootReal, repoPath === undefined ? ['diff', '--cached', '--no-color'] : ['diff', '--cached', '--no-color', '--', repoPath])
}

export async function opStage(rootReal: string, repoPaths: string[]): Promise<GitRunResult> {
  return runGit(rootReal, ['add', '--', ...repoPaths])
}

export async function opUnstage(rootReal: string, repoPaths: string[]): Promise<GitRunResult> {
  return runGit(rootReal, ['reset', 'HEAD', '--', ...repoPaths])
}

export async function opCommit(rootReal: string, message: string): Promise<GitRunResult> {
  return runGit(rootReal, ['commit', '-m', message])
}

export type NetworkAction = 'fetch' | 'pull' | 'push'

export async function opNetwork(rootReal: string, action: NetworkAction, remote: string): Promise<GitRunResult> {
  const tail = action === 'push'
    ? [remote]
    : action === 'pull'
      ? ['--ff-only', remote]
      : [remote, '--prune']
  return runGit(rootReal, [action, ...tail], { timeoutMs: NETWORK_TIMEOUT_MS })
}
