/**
 * Host-side Windows tree teardown through the System32 `taskkill.exe`.
 * A bare command name must never be spawned from this process: libuv on
 * Windows resolves it against the current working directory before PATH
 * (#268), and that directory is the model-writable workspace in the default
 * composition - a planted `taskkill.exe` there would execute with full host
 * privileges, outside every restricted-token boundary.
 * @module @deepseek-ai/dsh-subprocess-local/system-taskkill
 */

import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

/**
 * Resolve the system taskkill binary for teardown spawns.
 * @returns the absolute path under the Windows system root.
 */
export function systemTaskkillPath(): string {
  // Both variables are set on every supported Windows release; the literal is
  // the conventional last resort so the path stays absolute even without them.
  const systemRoot = process.env.SystemRoot ?? process.env.windir ?? 'C:\\Windows'
  return join(systemRoot, 'System32', 'taskkill.exe')
}

/**
 * Terminate one Windows process tree through the system binary, contained
 * like POSIX group signalling: delivery races tree exit, so an absent tree,
 * an exit race, and a missing binary (spawnSync reports, never throws) are as
 * tolerable here as ESRCH is for a POSIX group signal.
 * @param pid - root process id; non-positive is a no-op.
 * @param force - terminate without a grace window (`taskkill /F`).
 */
export function systemTaskkillTree(pid: number, force: boolean): void {
  if (pid <= 0) return
  const args = ['/PID', String(pid), '/T']
  if (force) args.push('/F')
  const options = { stdio: 'ignore' } as const
  spawnSync(systemTaskkillPath(), args, options)
}
