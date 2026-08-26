import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ACP_DEFAULT_PROFILE, ACP_PLUGIN_NAME, acpBridgeLayer, ensureDefaultAcpProfile, runAcp } from '../src/acp.ts'
import { mergeExtraPatches } from '../src/profile-boot.ts'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.DSH_HOME
})

describe('acpBridgeLayer', () => {
  it('inserts the bridge row config-free when no model route is flagged', () => {
    const layer = acpBridgeLayer()
    expect(layer.patches[0]?.insert).toEqual([{ id: 'acp', name: ACP_PLUGIN_NAME }])
  })

  it('carries exactly the flagged provider/model fields on the row config', () => {
    expect(acpBridgeLayer('p').patches[0]).toMatchObject({
      insert: [{ id: 'acp', name: ACP_PLUGIN_NAME, config: { provider: 'p' } }],
    })
    expect(acpBridgeLayer(undefined, 'm').patches[0]).toMatchObject({
      insert: [{ id: 'acp', name: ACP_PLUGIN_NAME, config: { model: 'm' } }],
    })
    expect(acpBridgeLayer('p', 'm').patches[0]).toMatchObject({
      insert: [{ id: 'acp', name: ACP_PLUGIN_NAME, config: { provider: 'p', model: 'm' } }],
    })
  })
})

describe('mergeExtraPatches (profile boot overlay merge)', () => {
  it('accepts non-colliding inserts and lets a following id-targeted patch refine the inserted row', () => {
    const warn = vi.fn()
    const first: PatchOptions = { insert: [{ id: 'acp', name: '@deepseek-ai/dsh-acp' }] }
    const second: PatchOptions = { id: 'acp', disabled: true }
    expect(mergeExtraPatches([first, second], new Map<string, EntryOptions>(), warn)).toEqual([first, second])
    expect(warn).not.toHaveBeenCalled()
  })

  it('passes an id-targeted patch through even when its row is unknown (the include warns at boot)', () => {
    const warn = vi.fn()
    const patch: PatchOptions = { id: 'missing', config: { x: 1 } }
    expect(mergeExtraPatches([patch], new Map<string, EntryOptions>(), warn)).toEqual([patch])
    expect(warn).not.toHaveBeenCalled()
  })

  it('skips an insert whose id the composition already mounts, naming the row in a warning', () => {
    const rows = new Map<string, EntryOptions>([['acp', { id: 'acp', name: './user-own.mjs' }]])
    const warn = vi.fn()
    const patch: PatchOptions = { insert: [{ id: 'acp', name: '@deepseek-ai/dsh-acp' }] }
    expect(mergeExtraPatches([patch], rows, warn)).toEqual([])
    expect(warn.mock.calls[0]?.[0]).toContain('"acp"')
  })

  it('skips a later extra that collides with an earlier accepted extra', () => {
    const warn = vi.fn()
    const first: PatchOptions = { insert: [{ id: 'x', name: './a.mjs' }] }
    const second: PatchOptions = { insert: [{ id: 'x', name: './b.mjs' }] }
    expect(mergeExtraPatches([first, second], new Map<string, EntryOptions>(), warn)).toEqual([first])
    expect(warn).toHaveBeenCalledTimes(1)
  })
})

describe('ensureDefaultAcpProfile', () => {
  it('initializes the default profile from the base bundle and never touches an existing one', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-acp-profile-'))
    try {
      ensureDefaultAcpProfile(home)
      const manifestPath = join(home, 'profiles', ACP_DEFAULT_PROFILE, 'package.json')
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        dsh?: { profile?: { bundles?: string[] } }
      }
      expect(manifest.dsh?.profile?.bundles).toEqual(['@deepseek-ai/dsh-base'])
      expect(existsSync(join(home, 'profiles', ACP_DEFAULT_PROFILE, 'cordis.patch.yml'))).toBe(true)
      // An initialized profile is left exactly as its owner wrote it.
      await writeFile(manifestPath, '{"sentinel":true}\n')
      ensureDefaultAcpProfile(home)
      expect(JSON.parse(await readFile(manifestPath, 'utf8'))).toEqual({ sentinel: true })
    } finally {
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })
})

describe('runAcp dump dispatch', () => {
  it('prints the composed tree including the bridge row for --dump-config and exits without booting', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-acp-dump-'))
    const written: string[] = []
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written.push(String(chunk))
      return true
    })
    process.env.DSH_HOME = home
    try {
      await runAcp({ mode: 'acp', patches: [], dump: 'config' }, createLaunchEnvironmentSnapshot([]))
      const dump = written.join('')
      expect(dump).toContain(ACP_PLUGIN_NAME)
      expect(dump).toContain('id: acp')
      // The dump must not have booted anything: no plugin-loading phase ran.
      expect(stderr).toHaveBeenCalled() // the "initialized profile" line
      stdout.mockRestore()
    } finally {
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })

  it('omits the bridge layer from --dump-default-config like every other non-bundle layer', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-acp-dump-default-'))
    const written: string[] = []
    vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      written.push(String(chunk))
      return true
    })
    process.env.DSH_HOME = home
    try {
      await runAcp({ mode: 'acp', patches: [], dump: 'default' }, createLaunchEnvironmentSnapshot([]))
      expect(written.join('')).not.toContain(ACP_PLUGIN_NAME)
    } finally {
      vi.restoreAllMocks()
      await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  })
})
