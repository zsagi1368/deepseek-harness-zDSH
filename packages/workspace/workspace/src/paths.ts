/**
 * Path canonicalization for workspace identity.
 * @module @deepseek-ai/dsh-workspace/src/paths
 */

import { realpath } from 'node:fs/promises'
import { posix, win32 } from 'node:path'

/** The two path grammars a canonical workspace path can be spelled in. */
export type PathSpelling = 'win32' | 'posix'

/**
 * Canonicalize a directory path via `fs.realpath`: trailing slashes, `..`
 * segments, and symlinks are all resolved. This is the ONE uniqueness canon of
 * the package — workspace paths are stored canonicalized, uniqueness is
 * string equality of canonicalized paths (a symlink to an existing
 * workspace's directory collides), and attach-time session `cwd` checks go
 * through the same canon. A path that does not exist rejects with the
 * original `ENOENT` — this is `create`'s reject path (a workspace must point
 * at an existing directory).
 * @param path - The path to canonicalize.
 * @returns the canonical absolute path.
 */
export async function realpathNormalize(path: string): Promise<string> {
  return await realpath(path)
}

/** The path grammar matching the current host, which is how `fs.realpath` output is spelled. */
function defaultSpelling(): PathSpelling {
  return process.platform === 'win32' ? 'win32' : 'posix'
}

/**
 * Root-aware default display title for a canonical workspace path: the
 * basename — or, where a filesystem root has no basename (`D:\`, `D:`, `/`),
 * the path itself minus trailing separators (`D:\` → `D:`; `/` stays `/`).
 * `path.basename` returns '' for volume roots, which used to store and render
 * a blank workspace title (#143). Call sites pass the grammar matching how
 * the path was produced; host-canonical paths follow `process.platform`.
 * @param path - Canonical directory path to name.
 * @param spelling - Path grammar to parse with; defaults to the current platform's.
 * @returns a non-empty display title for any absolute path.
 */
export function titleFromPath(path: string, spelling: PathSpelling = defaultSpelling()): string {
  const name = (spelling === 'win32' ? win32 : posix).basename(path)
  if (name !== '') return name
  const trimmed = path.replace(/[\\/]+$/, '')
  // A bare '/' trims to nothing; the full path is then the only sensible title.
  return trimmed === '' ? path : trimmed
}
