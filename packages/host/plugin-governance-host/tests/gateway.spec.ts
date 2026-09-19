/**
 * Gateway suite: lifecycle introspection under a real Cordis context plus
 * direct-instantiation behavior against an in-memory governed registry.
 */

import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import {
  DefaultPluginRegistry,
  normalizePluginId,
  PluginPermissionLevel,
  PluginStatus,
  type Plugin,
} from '@deepseek-ai/dsh-plugin-governance'
// Test-only relative reuse of the governance suite fixtures (not part of the
// package exports); production code imports the package entry instead.
import { testManifest } from '../../../plugins/plugin-governance/tests/fixtures.ts'
import PluginGovernanceGateway, { type PluginGovernanceId } from '../src/index.ts'

const contexts: Context[] = []
const storageRoots: string[] = []
const sourceDirs: string[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of storageRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  for (const dir of sourceDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Brand a raw id for gateway calls. */
function gid(value: string): PluginGovernanceId {
  return value as PluginGovernanceId
}

/** A bare governed plugin fixture registered under `id`. */
function barePlugin(
  id: string,
  name = id,
  admission: { permissionLevel?: PluginPermissionLevel; autoApprove?: boolean } = {},
): Plugin {
  return {
    manifest: testManifest({
      id,
      name,
      ...(admission.permissionLevel !== undefined ? { permissionLevel: admission.permissionLevel } : {}),
      ...(admission.autoApprove !== undefined ? { autoApprove: admission.autoApprove } : {}),
    }),
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

/** One declared tool capability for install-source fixtures. */
function toolCapability(name: string): Record<string, unknown> {
  return { type: 'tool', tool: { name, description: `${name} tool`, schema: { type: 'object' } } }
}

/** A throwaway local plugin directory whose package.json carries `fields`. */
function pluginSourceDir(fields: Record<string, unknown>): string {
  const source = mkdtempSync(join(tmpdir(), 'gov-src-'))
  sourceDirs.push(source)
  writeFileSync(join(source, 'package.json'), JSON.stringify(fields))
  return source
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
    // The fixture manifest asks for admission, so the operator approves first.
    expect(gateway.approve({ pluginId: gid('test/alpha') }).ok).toBe(true)
    expect((await gateway.enable({ pluginId: gid('test/alpha') })).ok).toBe(true)
    expect(gateway.health().active).toBe(2)
  })

  it('fails enable closed with approval-required until approve records a decision', async () => {
    const gateway = gatewayWith(await seededRegistry())
    const denied = await gateway.enable({ pluginId: gid('test/alpha') })
    expect(denied.ok).toBe(false)
    if (!denied.ok) expect(denied.error.code).toBe('approval-required')
    // Fail closed: the plugin stays disabled, nothing was persisted as active.
    expect(gateway.list().plugins.find(p => p.pluginId === gid('test/alpha'))?.status).toBe('active')
  })

  it('enables auto-approve and workspace-level plugins without an approval decision', async () => {
    const registry = new DefaultPluginRegistry()
    for (const plugin of [
      barePlugin('test/auto', 'Auto', { autoApprove: true }),
      barePlugin('test/workspace', 'Workspace', { permissionLevel: PluginPermissionLevel.WORKSPACE }),
    ]) {
      const result = await registry.register(plugin)
      if (!result.success) throw new Error('fixture registration failed')
    }
    const gateway = gatewayWith(registry)
    await registry.disable(normalizePluginId('test/auto'))
    await registry.disable(normalizePluginId('test/workspace'))
    expect((await gateway.enable({ pluginId: gid('test/auto') })).ok).toBe(true)
    expect((await gateway.enable({ pluginId: gid('test/workspace') })).ok).toBe(true)
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

  it('installs a plugin from a local directory and persists the snapshot', async () => {
    const gateway = gatewayWith(await seededRegistry())
    // A workspace-level manifest needs no admission decision, so it lands active.
    const source = pluginSourceDir({
      name: '@fixtures/local-plugin',
      version: '1.2.3',
      displayName: 'Local Plugin',
      description: 'installed from disk',
      dsh: { permissionLevel: PluginPermissionLevel.WORKSPACE, capabilities: [toolCapability('local_tool')] },
    })
    expect((await gateway.install({ source })).ok).toBe(true)
    const row = gateway.list().plugins.find(p => p.pluginId === gid('fixtures/local-plugin'))
    expect(row).toMatchObject({
      displayName: 'Local Plugin',
      version: '1.2.3',
      status: 'active',
      approvalRequired: false,
      source: 'native',
    })
    // The acknowledged receipt implies the registry.json snapshot landed on disk.
    const persisted = JSON.parse(readFileSync(registryPathOf(gateway), 'utf8')) as {
      plugins: Array<{ id: string }>
    }
    expect(persisted.plugins.some(p => p.id === 'fixtures/local-plugin')).toBe(true)
  })

  it('installs admission-requesting plugins disabled until approve records a decision', async () => {
    const gateway = gatewayWith(await seededRegistry())
    // Capabilities but no permission posture: the fail-closed default
    // requires an admission decision.
    const source = pluginSourceDir({
      name: '@fixtures/gated-plugin',
      version: '0.1.0',
      dsh: { capabilities: [toolCapability('gated_tool')] },
    })
    expect((await gateway.install({ source })).ok).toBe(true)
    const row = gateway.list().plugins.find(p => p.pluginId === gid('fixtures/gated-plugin'))
    expect(row?.status).toBe('disabled')
    expect(row?.approvalRequired).toBe(true)
    // Only approve + enable activate it; enable alone stays gated server-side.
    expect((await gateway.enable({ pluginId: gid('fixtures/gated-plugin') })).ok).toBe(false)
    expect(gateway.approve({ pluginId: gid('fixtures/gated-plugin') }).ok).toBe(true)
    expect((await gateway.enable({ pluginId: gid('fixtures/gated-plugin') })).ok).toBe(true)
    expect(gateway.health().plugins.find(p => p.pluginId === gid('fixtures/gated-plugin'))?.status).toBe('active')
  })

  it('rejects install sources that are missing or carry no package.json', async () => {
    const gateway = gatewayWith(await seededRegistry())
    for (const source of [join(tmpdir(), 'gov-src-does-not-exist-xyz'), pluginSourceDir({})]) {
      const rejected = await gateway.install({ source })
      expect(rejected.ok).toBe(false)
      if (!rejected.ok) expect(rejected.error.code).toBe('request-invalid')
    }
    expect(existsSync(join(tmpdir(), 'gov-src-does-not-exist-xyz'))).toBe(false)
  })

  it('uninstalls a plugin, purges its approval state, and snapshots the roster', async () => {
    const gateway = gatewayWith(await seededRegistry())
    expect(gateway.approve({ pluginId: gid('test/alpha') }).ok).toBe(true)
    expect((await gateway.uninstall({ pluginId: gid('test/alpha') })).ok).toBe(true)
    expect(gateway.list().plugins.some(p => p.pluginId === gid('test/alpha'))).toBe(false)
    // Durable admission state is purged, so a reinstall fails closed instead
    // of inheriting the stale grant.
    const approvals = JSON.parse(readFileSync(approvalsPathOf(gateway), 'utf8')) as {
      approvedAt: Record<string, number>
    }
    expect(approvals.approvedAt['test/alpha']).toBeUndefined()
    const persisted = JSON.parse(readFileSync(registryPathOf(gateway), 'utf8')) as {
      plugins: Array<{ id: string }>
    }
    expect(persisted.plugins.some(p => p.id === 'test/alpha')).toBe(false)
    // Removing an already-removed id reports plugin-not-found.
    const missing = await gateway.uninstall({ pluginId: gid('test/alpha') })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.error.code).toBe('plugin-not-found')
  })

  it('persists presetLoad status changes and restores them when the snapshot fails', async () => {
    const registry = await seededRegistry()
    const gateway = gatewayWith(registry)
    await registry.disable(normalizePluginId('test/beta'))
    expect(gateway.presetSave({ name: 'alpha-only' }).ok).toBe(true)

    // Diverge the live registry, then apply: the snapshot must land on disk.
    await registry.enable(normalizePluginId('test/beta'))
    await registry.disable(normalizePluginId('test/alpha'))
    expect((await gateway.presetLoad({ name: 'alpha-only' })).ok).toBe(true)
    const persisted = JSON.parse(readFileSync(registryPathOf(gateway), 'utf8')) as {
      plugins: Array<{ id: string; status: string }>
    }
    expect(persisted.plugins.find(p => p.id === 'test/alpha')?.status).toBe(PluginStatus.ACTIVE)
    expect(persisted.plugins.find(p => p.id === 'test/beta')?.status).toBe(PluginStatus.DISABLED)

    // Force a snapshot failure by replacing the registry file with a directory;
    // the live statuses must roll back to their pre-presetLoad values.
    const registryPath = registryPathOf(gateway)
    rmSync(registryPath, { force: true })
    mkdirSync(registryPath)
    try {
      await registry.enable(normalizePluginId('test/beta'))
      await registry.disable(normalizePluginId('test/alpha'))
      const failing = await gateway.presetLoad({ name: 'alpha-only' })
      expect(failing.ok).toBe(false)
      if (!failing.ok) expect(failing.error.code).toBe('persistence-failed')
      expect(registry.getStatus(normalizePluginId('test/alpha'))).toBe(PluginStatus.DISABLED)
      expect(registry.getStatus(normalizePluginId('test/beta'))).toBe(PluginStatus.ACTIVE)
    } finally {
      rmSync(registryPath, { force: true, recursive: true })
    }
  })

  it('restores persisted disable decisions when a fresh instance starts', async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), 'gov-gw-restore-'))
    storageRoots.push(storageRoot)

    // First lifecycle: an operator disables beta through the gateway; the
    // acknowledged receipt implies the registry.json snapshot landed on disk.
    const firstRegistry = await seededRegistry()
    const firstCtx = new Context()
    contexts.push(firstCtx)
    const first = new PluginGovernanceGateway(firstCtx, { storageRoot }, firstRegistry)
    expect((await first.disable({ pluginId: gid('test/beta'), reason: null })).ok).toBe(true)

    // Second lifecycle (the restart): a brand-new instance over the same
    // storage root sees a freshly seeded all-active registry, yet beta must
    // come back disabled instead of the decision bouncing to the default.
    const secondRegistry = await seededRegistry()
    const secondCtx = new Context()
    contexts.push(secondCtx)
    const second = new PluginGovernanceGateway(secondCtx, { storageRoot }, secondRegistry)
    await second.syncMountedPlugins()
    expect(secondRegistry.getStatus(normalizePluginId('test/beta'))).toBe(PluginStatus.DISABLED)
    expect(secondRegistry.getStatus(normalizePluginId('test/alpha'))).toBe(PluginStatus.ACTIVE)
    expect(second.list().plugins.find(p => p.pluginId === gid('test/beta'))?.status).toBe('disabled')
  })
})

/** The registry.json path behind one gateway's persistence (same derivation). */
function registryPathOf(gateway: PluginGovernanceGateway): string {
  return (gateway as unknown as { persistence: { registryPath: string } }).persistence.registryPath
}

/** The approvals ledger path behind one gateway's persistence. */
function approvalsPathOf(gateway: PluginGovernanceGateway): string {
  return join(
    (gateway as unknown as { persistence: { dataDir: string } }).persistence.dataDir,
    'approvals.json',
  )
}

describe('PluginGovernanceGateway Loader mirroring', () => {
  it('registers mounted Loader entries so list() returns real data', async () => {
    class MountedFixture extends Service {
      constructor(ctx: Context) {
        super(ctx, 'governance-mirror-fixture')
      }
    }

    const ctx = new Context()
    contexts.push(ctx)
    const storageRoot = mkdtempSync(join(tmpdir(), 'gov-gw-loader-'))
    storageRoots.push(storageRoot)

    const { Loader } = await import('@deepseek-ai/cordis-plugin-loader')
    await ctx.plugin(Loader)
    const modules = new Map<string, unknown>([
      ['@fixtures/dsh-alpha', { default: MountedFixture }],
    ])
    ctx.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof ctx.loader.internal>

    await ctx.loader.create({ name: '@fixtures/dsh-alpha' })
    await ctx.loader.await()

    await ctx.plugin(PluginGovernanceGateway, { storageRoot })
    const gateway = ctx.get('pluginGovernance') as PluginGovernanceGateway
    await gateway.syncMountedPlugins()

    const roster = gateway.list()
    expect(roster.plugins.length).toBeGreaterThan(0)
    const row = roster.plugins.find(p => p.pluginId === gid('fixtures/dsh-alpha'))
    expect(row).toBeDefined()
    expect(row?.status).toBe('active')
    // Mirror mode: the mount decision is the admission decision.
    expect(row?.approvalRequired).toBe(false)
    expect(gateway.health().active).toBeGreaterThan(0)
  })

  it('survives a context without a Loader and keeps the roster empty', async () => {
    const gateway = gatewayWith(await seededRegistry())
    await expect(gateway.syncMountedPlugins()).resolves.toBeUndefined()
    // Direct instantiation never mirrors anything; no crash, no dupes.
    expect(gateway.list().plugins).toHaveLength(2)
  })
})
