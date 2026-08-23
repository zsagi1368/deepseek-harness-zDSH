/**
 * Gateway suite: lifecycle introspection under a real Cordis context plus
 * direct-instantiation behavior against an in-memory governed registry.
 */

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import {
  DefaultPluginRegistry,
  normalizePluginId,
  PluginStatus,
  type Plugin,
} from '@deepseek-ai/dsh-plugin-governance'
// Test-only relative reuse of the governance suite fixtures (not part of the
// package exports); production code imports the package entry instead.
import { testManifest } from '../../../plugins/plugin-governance/tests/fixtures.ts'
import PluginGovernanceGateway, { type PluginGovernanceId } from '../src/index.ts'

const contexts: Context[] = []
const storageRoots: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of storageRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Brand a raw id for gateway calls. */
function gid(value: string): PluginGovernanceId {
  return value as PluginGovernanceId
}

/** A bare governed plugin fixture registered under `id`. */
function barePlugin(id: string, name = id): Plugin {
  return {
    manifest: testManifest({ id, name }),
    install: () => {},
    uninstall: () => {},
  }
}

/** A registry pre-seeded with two governed plugins. */
async function seededRegistry(): Promise<DefaultPluginRegistry> {
  const registry = new DefaultPluginRegistry()
  for (const plugin of [barePlugin('test/alpha', 'Alpha'), barePlugin('test/beta', 'Beta')]) {
    const result = await registry.register(plugin)
    if (!result.success) throw new Error('fixture registration failed')
  }
  return registry
}

/** Direct instantiation against a throwaway storage root (auto-cleaned). */
function gatewayWith(registry: DefaultPluginRegistry): PluginGovernanceGateway {
  const ctx = new Context()
  contexts.push(ctx)
  const storageRoot = mkdtempSync(join(tmpdir(), 'gov-gw-'))
  storageRoots.push(storageRoot)
  return new PluginGovernanceGateway(ctx, { storageRoot }, registry)
}

describe('PluginGovernanceGateway', () => {
  it('publishes the pluginGovernance namespace over the full remote method face', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    await ctx.plugin(PluginGovernanceGateway, { storageRoot: mkdtempSync(join(tmpdir(), 'gov-gw-')) })
    const gateway = ctx.get('pluginGovernance') as PluginGovernanceGateway
    expect(gateway.typertRemote).toMatchObject({
      serviceKey: 'pluginGovernance',
      namespace: 'pluginGovernance',
    })
  })

  it('projects the roster with auto-approval state for plain manifests', async () => {
    const roster = gatewayWith(await seededRegistry()).list()
    expect(roster.plugins.map(p => p.pluginId)).toEqual([gid('test/alpha'), gid('test/beta')])
    for (const row of roster.plugins) {
      // Fail-closed: manifests without an explicit permission level require admission.
      expect(row.approvalRequired).toBe(true)
      expect(row.approved).toBe(false)
      expect(row.status).toBe('active')
    }
  })

  it('returns plugin-not-found for unknown ids', async () => {
    const result = gatewayWith(await seededRegistry()).get({ pluginId: gid('test/missing') })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('plugin-not-found')
  })

  it('disables with receipt, reflects in health, and re-enables cleanly', async () => {
    const registry = await seededRegistry()
    const gateway = gatewayWith(registry)
    const disabled = await gateway.disable({ pluginId: gid('test/alpha'), reason: 'operator pause' })
    expect(disabled.ok).toBe(true)
    expect(registry.getStatus(normalizePluginId('test/alpha'))).toBe(PluginStatus.DISABLED)
    expect(gateway.health().disabled).toBe(1)
    expect((await gateway.enable({ pluginId: gid('test/alpha') })).ok).toBe(true)
    expect(gateway.health().active).toBe(2)
  })

  it('records approvals and surfaces them on the roster', async () => {
    const gateway = gatewayWith(await seededRegistry())
    expect(gateway.approve({ pluginId: gid('test/alpha') }).ok).toBe(true)
    expect(gateway.list().plugins.find(p => p.pluginId === gid('test/alpha'))?.approved).toBe(true)
  })

  it('round-trips presets including duplicate rejection and unknown-id reporting', async () => {
    const registry = await seededRegistry()
    const gateway = gatewayWith(registry)
    await registry.disable(normalizePluginId('test/beta'))
    expect(gateway.presetSave({ name: 'focus-alpha' }).ok).toBe(true)
    const duplicate = gateway.presetSave({ name: 'focus-alpha' })
    expect(duplicate.ok).toBe(false)
    if (!duplicate.ok) expect(duplicate.error.code).toBe('preset-already-exists')

    await registry.enable(normalizePluginId('test/beta'))
    await registry.disable(normalizePluginId('test/alpha'))
    const applied = await gateway.presetLoad({ name: 'focus-alpha' })
    expect(applied.ok).toBe(true)
    if (applied.ok) {
      expect(applied.value.applied).toEqual([gid('test/alpha'), gid('test/beta')])
      expect(applied.value.unknown).toEqual([])
    }
    expect(gateway.presetDelete({ name: 'focus-alpha' }).ok).toBe(true)

    const missing = await gateway.presetLoad({ name: 'focus-alpha' })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe('preset-not-found')
  })

  it('rejects preset names outside the file-stem grammar', async () => {
    const registry = await seededRegistry()
    const bad = gatewayWith(registry).presetSave({ name: '../escape' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.error.code).toBe('request-invalid')
  })

  it('keeps install/uninstall explicitly not-implemented until admission lands', async () => {
    const gateway = gatewayWith(await seededRegistry())
    const install = gateway.install({ source: 'npm:some/package' })
    expect(install.ok).toBe(false)
    if (!install.ok) expect(install.error.code).toBe('not-implemented')
    const uninstall = gateway.uninstall({ pluginId: gid('test/alpha') })
    expect(uninstall.ok).toBe(false)
    if (!uninstall.ok) expect(uninstall.error.code).toBe('not-implemented')
  })
})
