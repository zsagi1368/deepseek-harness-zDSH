/**
 * Detection of one specific destructive shape (#149): a shell command that
 * recursively deletes the session workspace root ITSELF. The permission model
 * authorizes by path space, so under `workspace-write` such a deletion is
 * fully in-policy and invisible to approval flows — the caller raises an
 * explicit confirmation whenever this predicate matches, turning the silent
 * destruction of a whole workspace into a decided question.
 *
 * The predicate is deliberately conservative: only targets that RESOLVE to
 * the workspace root match. Deleting entries inside the workspace, globs that
 * expand to children (`rm -rf *`), or pipelines feeding `xargs rm` stay
 * ungated; widening this remains cheaper than crying wolf on ordinary
 * cleanup commands.
 * @module @deepseek-ai/dsh-shell/recursive-delete
 */

import { isAbsolute, resolve as resolvePath } from 'node:path'
import { tokenizeCommandLine } from './command-tokenize.ts'

/** Shell dialects the detector speaks. */
export type ShellDialect = 'bash' | 'pwsh'

/** One detector query: the command, the protected root, and where relative targets anchor. */
export interface RecursiveDeleteProbe {
  /** Shell dialect the command is written for. */
  readonly dialect: ShellDialect
  /** The raw command line exactly as the model wrote it. */
  readonly command: string
  /** The session workspace root the gate protects (any spelling resolves through the host path semantics). */
  readonly workspaceRoot: string
  /** Directory relative targets resolve against — the call's workdir, defaulting to the root. */
  readonly cwd?: string
}

/**
 * Verbs that delete their (first) target argument, per dialect.
 * PowerShell aliases are matched case-insensitively; bash names may arrive
 * through an absolute or slash-prefixed spelling, which the suffix match
 * covers.
 */
const DELETE_VERBS: Record<ShellDialect, (token: string) => boolean> = {
  bash: token => token === 'rm' || token.endsWith('/rm'),
  pwsh: (token) => {
    const name = token.toLowerCase()
    return ['remove-item', 'ri', 'del', 'erase', 'rd', 'rm', 'rm-dir', 'rmdir'].includes(name)
  },
}

/**
 * Whether one argv token turns the delete verb recursive.
 * Bundled short flags (`rm -rf`, `-dfr`) count; PowerShell prefix matching
 * follows its own abbreviation rules (`-Rec`, `-Recurse`).
 */
function isRecursiveFlag(token: string, dialect: ShellDialect): boolean {
  if (dialect === 'bash') return /^-[a-zA-Z]*[rR][a-zA-Z]*$/.test(token) || token === '--recursive'
  return /^-r$/.test(token.toLowerCase()) || /^-rec/.test(token.toLowerCase())
}

/** Tokens that end the current simple command; whatever follows is another command. */
const COMMAND_OPERATORS = new Set([';', '|', '&&', '||', '&'])

/** Option-value switches whose next token is a deletion target (PowerShell). */
const PATH_VALUE_FLAGS = /^-(literal)?path$|^-(pspath)$/i

/** Peel one level of matching quotes so quoted roots resolve as themselves. */
function unquote(token: string): string {
  if (token.length >= 2
    && ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'")))) {
    return token.slice(1, -1)
  }
  return token
}

/**
 * Whether one target spelling lands on the protected root itself.
 * Comparison goes through host path resolution (so `.`, trailing separators,
 * mixed separators, and traversal collapse identically) and folds case only
 * where the platform's paths are case-insensitive.
 */
function targetsRoot(target: string, probe: RecursiveDeleteProbe): boolean {
  const raw = unquote(target)
  if (raw.length === 0) return false
  const cwd = probe.cwd ?? probe.workspaceRoot
  // Common spellings the shell would expand before the filesystem ever sees
  // them; without this a root-referencing variable sails past the gate.
  const expanded = raw === '$PWD' || raw === '${PWD}' || raw === '$(pwd)' || raw === '%CD%'
    ? cwd
    : raw
  let absolute = isAbsolute(expanded) ? expanded : resolvePath(cwd, expanded)
  // Git Bash on Windows executes MSYS spellings that resolve() would read as
  // a literal rootless path; translate to the drive form first.
  if (probe.dialect === 'bash' && process.platform === 'win32') {
    const msys = /^\/([a-z])(?:\/(.*))?$/i.exec(absolute)
    if (msys !== null) {
      absolute = (msys[1] ?? '').toUpperCase() + ':\\' + (msys[2] ?? '').replace(/\//g, '\\')
    }
  }
  const left = resolvePath(absolute)
  const right = resolvePath(probe.workspaceRoot)
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right
}

/**
 * Detect a command that recursively deletes the session workspace root itself.
 * Scans every simple command in the line (operators split them), so chained
 * deletions cannot hide behind an earlier harmless segment.
 * @param probe - the command, the protected root, and the anchoring directory.
 * @returns the human-readable reason for the approval prompt, or undefined when nothing matches.
 */
export function recursiveWorkspaceRootDelete(probe: RecursiveDeleteProbe): string | undefined {
  // Quote- and operator-aware tokenization: glued operators (`rm -rf .&&echo`)
  // must split into segments, and quoted roots survive as one token.
  const tokens = tokenizeCommandLine(probe.command)
  const dialect = probe.dialect
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as string
    if (COMMAND_OPERATORS.has(token)) continue
    if (!DELETE_VERBS[dialect](token)) continue
    // Scan this simple command's remaining tokens for a recursive flag and
    // root-targeted operands. Targets are judged together at the segment's
    // end because option order is free (`rm root -rf` is legal bash).
    let sawRecursive = false
    let operandsOnly = false
    const targets: string[] = []
    let scan = index + 1
    for (; scan < tokens.length; scan += 1) {
      const candidate = tokens[scan] as string
      if (COMMAND_OPERATORS.has(candidate)) break
      if (candidate === '--') {
        operandsOnly = true
        continue
      }
      if (!operandsOnly && candidate.startsWith('-')) {
        if (dialect === 'pwsh' && PATH_VALUE_FLAGS.test(candidate)) {
          const value: string | undefined = tokens[scan + 1]
          if (value !== undefined && !value.startsWith('-')) {
            targets.push(value)
            scan += 1
          }
          continue
        }
        if (isRecursiveFlag(candidate, dialect)) sawRecursive = true
        continue
      }
      targets.push(candidate)
    }
    if (sawRecursive && targets.some(target => targetsRoot(target, probe))) return reasonFor(probe)
  }
  return undefined
}

/** Compose the prompt reason naming what would be destroyed. */
function reasonFor(probe: RecursiveDeleteProbe): string {
  return 'this command recursively deletes the session workspace root itself '
    + `(${probe.workspaceRoot}) — confirm before the entire workspace is destroyed`
}
