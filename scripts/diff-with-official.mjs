#!/usr/bin/env node
/**
 * Human-readable net difference between this branch and upstream/master.
 *
 * Usage:
 *   node scripts/diff-with-official.mjs            # print summary
 *   node scripts/diff-with-official.mjs --out FILE # also write the summary to FILE
 *
 * Excluded from the net view: docs/dsh/** (fork-local documentation) and the
 * lockfile (its version lines churn with every sync).
 */

import { execFileSync } from 'node:child_process'

const BASE = 'upstream/master'
const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const outFile = outIndex >= 0 ? args[outIndex + 1] : undefined

function git(fileArgs) {
  return execFileSync('git', fileArgs, { encoding: 'utf8' })
}

const nameStatus = git([
  'diff', '--name-status', '--no-renames', `${BASE}...HEAD`,
])
const stat = git(['diff', '--stat', `${BASE}...HEAD`, '--', ':!docs/dsh', ':!pnpm-lock.yaml'])

const lines = nameStatus.split('\n').filter(Boolean)
const added = []
const modified = []
const deleted = []
for (const line of lines) {
  const [status, ...rest] = line.split('\t')
  const path = rest.join('\t')
  if (path.startsWith('docs/dsh/') || path === 'pnpm-lock.yaml') continue
  if (status === 'A') added.push(path)
  else if (status === 'M') modified.push(path)
  else if (status === 'D') deleted.push(path)
}

const summary = [
  `base: ${BASE}`,
  `added: ${added.length} | modified(excl. docs/dsh & lockfile): ${modified.length} | deleted: ${deleted.length} (restored-to-official policy)`,
  '',
  '--- added ---',
  ...added,
  '',
  '--- modified ---',
  ...modified,
  '',
  '--- deleted ---',
  ...deleted,
  '',
  stat.trimEnd(),
].join('\n')

console.log(summary)
if (outFile !== undefined) {
  const fs = await import('node:fs')
  const path = await import('node:path')
  fs.mkdirSync(path.dirname(outFile), { recursive: true })
  fs.writeFileSync(outFile, summary + '\n')
  console.log(`written: ${outFile}`)
}
