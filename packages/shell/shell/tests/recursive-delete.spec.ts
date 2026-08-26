/** Detection of recursive deletion of the session workspace root itself (#149). */

import { describe, expect, it } from 'vitest'
import { recursiveWorkspaceRootDelete } from '../src/recursive-delete.ts'

const ROOT = '/home/user/workspace'

function probe(command: string, overrides: { dialect?: 'bash' | 'pwsh'; cwd?: string } = {}) {
  const base: { dialect: 'bash' | 'pwsh'; command: string; workspaceRoot: string; cwd?: string } = {
    dialect: overrides.dialect ?? 'bash',
    command,
    workspaceRoot: ROOT,
  }
  if (overrides.cwd !== undefined) base.cwd = overrides.cwd
  return base
}

describe('recursiveWorkspaceRootDelete', () => {
  it('matches the canonical bash shapes that destroy the workspace root', () => {
    for (const command of [
      `rm -rf ${ROOT}`,
      `rm -r ${ROOT}`,
      'rm -rf .',
      'rm -rf ./',
      'rm -fr .',
      'rm --recursive .',
      'rm -dfr -- .',
      `rm -rf "${ROOT}"`,
      `rm -rf ${ROOT}/`,
      `rm ${ROOT} -rf`,
      'cd sub && rm -rf ..',
    ]) {
      const nested = command.includes('..') || command.startsWith('cd ')
      const hit = recursiveWorkspaceRootDelete(probe(command, nested ? { cwd: `${ROOT}/sub` } : {}))
      expect(hit, command).toContain('workspace root')
    }
  })

  it('resolves relative targets against the call workdir, not the root', () => {
    // '.' from a nested workdir deletes that subdir, not the root.
    expect(recursiveWorkspaceRootDelete(probe('rm -rf .', { cwd: `${ROOT}/sub` }))).toBeUndefined()
    // From the root itself (the default when no workdir is passed) it does.
    expect(recursiveWorkspaceRootDelete(probe('rm -rf .'))).toContain('workspace root')
  })

  it('leaves ordinary cleanup and non-recursive deletions alone', () => {
    for (const command of [
      'rm file.txt',
      'rm -r ./build dist',
      `rm -rf ${ROOT}/node_modules`,
      'rm -rf sub/',
      'ls -R .',
      'grep -r pattern .',
      'npm run clean',
    ]) {
      expect(recursiveWorkspaceRootDelete(probe(command)), command).toBeUndefined()
    }
  })

  it('asks even for borderline shapes like git rm -rf of the whole tree', () => {
    // git rm only untracks worktree files, but destroying the entire tracked
    // tree is exactly the shape a user must confirm; err toward asking.
    expect(recursiveWorkspaceRootDelete(probe('git rm -rf .'))).toContain('workspace root')
  })

  it('gates every segment of a chained line but only on its own merits', () => {
    expect(recursiveWorkspaceRootDelete(probe(`echo hi; rm -rf ${ROOT}`))).toContain('workspace root')
    expect(recursiveWorkspaceRootDelete(probe(`rm -rf ${ROOT} | tee log`))).toContain('workspace root')
    expect(recursiveWorkspaceRootDelete(probe(`rm -rf build && rm -rf ${ROOT}/dist`))).toBeUndefined()
  })

  it('speaks PowerShell: cmdlets, aliases, abbreviations, and -Path values', () => {
    const pwsh = { dialect: 'pwsh' as const }
    for (const command of [
      'Remove-Item -Recurse .',
      'Remove-Item . -Recurse',
      'Remove-Item -Recurse -Force -Path .',
      'ri -rec ./',
      'rd -Recurse .',
      'del -recurse .',
      `Remove-Item -Recurse "${ROOT}"`,
    ]) {
      expect(recursiveWorkspaceRootDelete(probe(command, pwsh)), command).toContain('workspace root')
    }
    for (const command of [
      'Remove-Item file.log',
      'Remove-Item -Recurse ./build',
      'remove-item ./x',
    ]) {
      expect(recursiveWorkspaceRootDelete(probe(command, pwsh)), command).toBeUndefined()
    }
  })

  it('compares paths case-insensitively only where the platform does', () => {
    if (process.platform !== 'win32') return
    const windowsRoot = String.raw`C:\Users\dev\ws`
    expect(recursiveWorkspaceRootDelete({
      dialect: 'bash', command: 'rm -rf c:/users/DEV/ws', workspaceRoot: windowsRoot,
    })).toContain('workspace root')
  })
})
