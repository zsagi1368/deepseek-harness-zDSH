/**
 * Platform binary-lookup probe resolution (TC-B4-H1 face 7; per the FB1
 * adjudication note this is defense-in-depth hardening, not a blocking fix —
 * wording discipline: no overstatement).
 *
 * The lookup probes in git-runner / pty-registry were historically spawned by
 * bare name (`where.exe` / `which`). On win32, CreateProcess searches the
 * application directory and the parent-process CWD BEFORE System32 for a
 * bare-named executable, and the `spawnSync` `cwd` option only sets the child
 * working directory — it does not take part in executable lookup. A planted
 * `where.exe` in the host CWD (typical: the server started inside an
 * untrusted clone/download directory) would therefore run before the real
 * system binary. This module resolves the probe itself to an absolute path:
 * every candidate passes non-empty + isAbsolute + existsSync, and when all
 * candidates are missing the resolution fails closed (never a bare-name
 * fallback).
 *
 * Boundary (honest scope): this hardens the "probe itself is planted" window.
 * CWD planting of the LOOKED-UP target (git/pwsh/…) is guarded by the
 * existing "probe cwd pinned to SystemRoot" leg (REVIEW-PC1 discriminative
 * probe: the load-bearing wall) — the two faces are orthogonal and neither
 * replaces the other. POSIX execvp does not search the CWD (unless PATH
 * contains `.`), so the bare-name probe risk is win32-specific; the POSIX
 * side is absolutized in the same shape (removing the PATH-shaped `which`
 * dependency ambiguity).
 * @module
 */
import { existsSync } from 'node:fs'
import { win32 } from 'node:path'

/**
 * Key-shape polymorphism for the Windows root env keys (WS1 deviation-1
 * measured posture: under Git Bash/MSYS hosts Object.keys(process.env) is
 * all-upper; node's env access on win32 is case-insensitive [REVIEW-WS1
 * suggestion-1 corrected posture], so the first key always hits and the
 * polymorphic loop is harmless redundancy; windir/WINDIR is the real
 * fallback leg — a different variable).
 */
const WINDOWS_ROOT_KEYS = ['SystemRoot', 'SYSTEMROOT', 'windir', 'WINDIR'] as const

/** Last-resort candidate when every env key is missing/unusable: the fixed system dir (existsSync-checked; missing ⇒ fail closed). */
const WINDOWS_LAST_RESORT = 'C:\\Windows\\System32\\where.exe'

/** Conventional POSIX `which` locations (same shape: existsSync per candidate, fail closed when all are missing). */
const POSIX_WHICH_CANDIDATES = ['/usr/bin/which', '/bin/which', '/usr/local/bin/which'] as const

/**
 * Resolve this platform's binary-lookup probe to an absolute path.
 *
 * Candidate construction and existence checks run OUTSIDE any try (task-card
 * "构造 try 外": join/existsSync do not throw, and a construction defect must
 * never be laundered into "not found" by a caller's catch).
 * @returns the absolute probe path, or `null` when every candidate is missing
 *   (fail-closed: callers refuse resolution / fall through to their documented
 *   fallbacks, never re-entering a bare-name spawn).
 */
export function resolveLookupProbe(): string | null {
  if (process.platform === 'win32') {
    for (const key of WINDOWS_ROOT_KEYS) {
      const root = process.env[key]?.trim()
      if (root === undefined || root === '') continue
      if (!win32.isAbsolute(root)) continue
      const candidate = win32.join(root, 'System32', 'where.exe')
      if (existsSync(candidate)) return candidate
    }
    return existsSync(WINDOWS_LAST_RESORT) ? WINDOWS_LAST_RESORT : null
  }
  for (const candidate of POSIX_WHICH_CANDIDATES) {
    if (existsSync(candidate)) return candidate
  }
  return null
}
