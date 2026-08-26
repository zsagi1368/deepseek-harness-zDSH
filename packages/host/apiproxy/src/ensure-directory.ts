/**
 * Session working-directory provisioning guard for `session.create`.
 * @module @deepseek-ai/dsh-host-apiproxy/ensure-directory
 */

import { mkdir, stat } from 'node:fs/promises'

/** Filesystem surface of {@link ensureProjectDirectory}, injectable for tests. */
export interface ProjectDirectoryIo {
  /** Probe whether a path already resolves to a directory. */
  stat(path: string): Promise<{ isDirectory(): boolean }>
  /** Create a directory tree; only called when the probe did not confirm one. */
  mkdir(path: string, options: { recursive: true }): Promise<unknown>
}

/**
 * Ensure a session's working directory exists before agent creation. The
 * directory is created (with parents) only when a stat probe does not already
 * confirm one: Windows volume roots (`D:\`) reject
 * `mkdir(..., { recursive: true })` with EPERM despite already existing —
 * `CreateDirectoryW` answers ERROR_ACCESS_DENIED rather than
 * ERROR_ALREADY_EXISTS there, and Node swallows only EEXIST (#143) — while an
 * ordinary existing directory made that mkdir a no-op anyway, so skipping it
 * changes nothing for non-root paths. A failed probe falls through to mkdir
 * so its error stays the authoritative failure.
 * @param cwd - Session working directory to provision.
 * @param io - Filesystem surface; defaults to `node:fs/promises`.
 * @returns resolution once `cwd` names an existing directory.
 * @throws when creation was required and failed; the original error rides along as `cause`.
 */
export async function ensureProjectDirectory(cwd: string, io: ProjectDirectoryIo = { stat, mkdir }): Promise<void> {
  let present = false
  try {
    present = (await io.stat(cwd)).isDirectory()
  } catch {
    // Absent or unprobeable: the mkdir below produces the authoritative error.
  }
  if (present) return
  try {
    await io.mkdir(cwd, { recursive: true })
  } catch (error: unknown) {
    throw new Error(`failed to ensure project directory "${cwd}": ${String(error)}`, { cause: error })
  }
}
