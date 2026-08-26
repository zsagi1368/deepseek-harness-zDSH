/**
 * S-06 pin: the launcher's one child-process surface — the `dsh plugin` pnpm
 * forwarder — must spawn its child with a hidden console window on every host
 * (`windowsHide`), because terminal hosts that do not share their console with
 * children otherwise flash a second backend console window. The win32 `.cmd`
 * shim resolution keeps its shell (CVE-2024-27980 hardening), and the forward
 * itself is unchanged: same command, anchored arguments, profile-directory cwd,
 * inherited stdio, pnpm exit code.
 */

import { describe, expect, it, vi } from 'vitest'
import { join, resolve } from 'node:path'

const spawnCalls = vi.hoisted(() => [] as Array<{
  command: string
  args: readonly string[]
  options: Record<string, unknown> | undefined
}>)

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawnSync: (command: string, args: readonly string[], options?: Record<string, unknown>) => {
    spawnCalls.push({ command, args, options })
    return { status: 0 }
  },
}))

const { pnpmForwardSpawnOptions, runPlugin } = await import('../src/plugin.ts')

describe('pnpmForwardSpawnOptions', () => {
  it('hides the child console window on every platform', () => {
    for (const platform of ['win32', 'linux', 'darwin'] as const) {
      expect(pnpmForwardSpawnOptions(platform).windowsHide, platform).toBe(true)
    }
  })

  it('keeps the shell only where the .cmd shim requires it', () => {
    expect(pnpmForwardSpawnOptions('win32').shell).toBe(true)
    expect(pnpmForwardSpawnOptions('linux').shell).toBe(false)
    expect(pnpmForwardSpawnOptions('darwin').shell).toBe(false)
  })

  it('inherits stdio so pnpm output reaches the invoking terminal', () => {
    expect(pnpmForwardSpawnOptions('win32').stdio).toBe('inherit')
    expect(pnpmForwardSpawnOptions('linux').stdio).toBe('inherit')
  })
})

describe('runPlugin forwarding options', () => {
  it('spawns pnpm in the profile directory with the hidden-window options and reports its exit code', async () => {
    const { mkdtempSync, rmSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const home = mkdtempSync(join(tmpdir(), 'dsh-plugin-forward-'))
    const previousHome = process.env.DSH_HOME
    process.env.DSH_HOME = home
    try {
      spawnCalls.length = 0
      const exitCode = runPlugin('web', ['add', './dep'])
      expect(exitCode).toBe(0)
      expect(spawnCalls).toHaveLength(1)
      const call = spawnCalls[0]!
      // The command shape is untouched by the option change.
      expect(call.command).toBe('pnpm')
      expect(call.args).toHaveLength(2)
      // The relative spec was already anchored against the invoking directory.
      expect(call.args[0]).toBe('add')
      expect(call.args[1]).toBe(resolve(process.cwd(), './dep'))
      // The wiring uses exactly the shared option object plus the per-call cwd.
      expect(call.options).toEqual({
        cwd: resolve(home, 'profiles/web'),
        ...pnpmForwardSpawnOptions(process.platform),
      })
    } finally {
      if (previousHome === undefined) Reflect.deleteProperty(process.env, 'DSH_HOME')
      else process.env.DSH_HOME = previousHome
      rmSync(home, { recursive: true, force: true })
    }
  })
})
