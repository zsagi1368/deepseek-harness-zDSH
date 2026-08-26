/**
 * Persisted-package export: plan building, digests, fail-closed validation,
 * the two-step confirm gate, and the LoadGuard shape of produced manifests.
 */

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LoadGuard, type Plugin as GovernedPlugin } from '@deepseek-ai/dsh-plugin-governance'
import { describe, expect, it } from 'vitest'
import {
  buildManifestObject, buildPersistedPackagePlan, digestPersistedPlan, inspectExistingPersistedArtifact,
  isSafePersistedSegment, persistedIdFor, sha256Hex, toGovernanceManifest, validatePersistedManifest,
  writePersistedPackage,
} from '../src/export.ts'
import type { PersistedPackagePlan } from '../src/export.ts'
import { CordisDynamicPackageId, CordisDynamicPluginId } from '../src/index.ts'
import type { CordisDynamicExportId } from '../src/types.ts'
import { AGENT_A, AGENT_B, setup } from './helpers.ts'

const HOST = 'return { apply() {} }'

/** Brand a literal export id for service calls, mirroring the transport. */
function exportId(value: string): CordisDynamicExportId {
  return value as CordisDynamicExportId
}

type Runner = Awaited<ReturnType<typeof setup>>['runner']

/** One live tree with a private persistence root. */
async function setupWithRoot(): Promise<{
  root: string
  cleanup: () => void
  runner: Runner
  gateway: Awaited<ReturnType<typeof setup>>['gateway']
}> {
  const root = mkdtempSync(join(tmpdir(), 'persist-export-'))
  const harness = await setup({ persistedPluginsRoot: root })
  return {
    root,
    cleanup: () => { rmSync(root, { recursive: true, force: true }) },
    runner: harness.runner,
    gateway: harness.gateway,
  }
}

/** Define and activate one host-only package owned by AGENT_A. */
async function mountCommitted(runner: Runner, host = HOST): Promise<{ pluginId: string; packageId: string }> {
  const defined = runner.define({
    sessionId: AGENT_A.id,
    plugin: { kind: 'new', idPrefix: 'keep' },
    name: 'keeper',
    purpose: 'outlive the process',
    code: { host },
  })
  await expect(runner.run(AGENT_A, defined.pluginId, defined.packageId, 'run')).resolves.toMatchObject({ ok: true })
  return { pluginId: String(defined.pluginId), packageId: String(defined.packageId) }
}

/** A minimal valid plan for writer-level cases. */
function planOf(rev: number): PersistedPackagePlan {
  return buildPersistedPackagePlan({
    pluginId: 'probe-9', packageId: 'pkg-4', sessionId: 'S-a', name: 'keeper', purpose: 'keep', hostCode: HOST, rev,
  })
}

describe('persisted id and segment safety', () => {
  it('derives the user-persisted governance id', () => {
    expect(persistedIdFor('probe-12')).toBe('user-persisted/probe-12')
    expect(isSafePersistedSegment('a_1-B')).toBe(true)
  })

  it('rejects traversal and separator segments', () => {
    for (const bad of ['../evil', 'a/b', '.', '..', '']) {
      expect(isSafePersistedSegment(bad)).toBe(false)
    }
    expect(() => persistedIdFor('../evil')).toThrow(/cannot be persisted/)
  })
})

describe('plan building and digests', () => {
  it('builds an explicit deny-all manifest with provenance', () => {
    const plan = buildPersistedPackagePlan({
      pluginId: 'probe-1', packageId: 'pkg-1', sessionId: 'S-a', name: 'Keeper', purpose: 'keep things', hostCode: HOST, rev: 3,
    })
    expect(plan.persistedId).toBe('user-persisted/probe-1')
    expect(plan.version).toBe('0.1.3')
    const manifest = buildManifestObject(plan)
    const dsh = manifest.dsh as Record<string, unknown>
    expect(manifest.name).toBe('user-persisted/probe-1')
    expect(manifest.version).toBe('0.1.3')
    expect(dsh.compatible).toBe('>=0.0.0')
    expect(dsh.permissionLevel).toBe('confirm-required')
    expect(dsh.origin).toBe('user-persisted')
    expect(dsh.persisted).toMatchObject({ rev: 3, originSession: 'S-a', originPluginId: 'probe-1', originPackageId: 'pkg-1' })
    const sandbox = dsh.sandbox as Record<string, unknown>
    expect(sandbox.type).toBe('inline')
    expect((sandbox.network as Record<string, unknown>).access).toBe('none')
    expect((sandbox.network as Record<string, unknown>).allowLocal).toBe(false)
    expect((sandbox.process as Record<string, unknown>).spawn).toBe(false)
    expect((sandbox.filesystem as Record<string, unknown>).access).toBe('readonly')
    const capabilities = dsh.capabilities as Array<Record<string, unknown>>
    expect(capabilities).toHaveLength(1)
    expect(capabilities[0]).toMatchObject({ type: 'service' })
  })

  it('reduces hostile display names to safe service names', () => {
    const hostile = buildPersistedPackagePlan({
      pluginId: 'probe-3', packageId: 'pkg-5', sessionId: 'S-a', name: '!!! --- ???', purpose: 'p', hostCode: HOST, rev: 1,
    })
    const capabilities = (buildManifestObject(hostile).dsh as Record<string, unknown>).capabilities as Array<{
      service?: { name?: string }
    }>
    expect(capabilities[0]?.service?.name).toBe('persisted-service')
    const mixed = buildPersistedPackagePlan({
      pluginId: 'probe-3', packageId: 'pkg-5', sessionId: 'S-a', name: 'My Cool Tool v2', purpose: 'p', hostCode: HOST, rev: 1,
    })
    const mixedCaps = (buildManifestObject(mixed).dsh as Record<string, unknown>).capabilities as Array<{
      service?: { name?: string }
    }>
    expect(mixedCaps[0]?.service?.name).toBe('my-cool-tool-v2')
  })

  it('changes the host digest with the bytes and keeps digests deterministic', () => {
    const base = buildPersistedPackagePlan({
      pluginId: 'probe-1', packageId: 'pkg-1', sessionId: 'S-a', name: 'k', purpose: 'p', hostCode: HOST, rev: 1,
    })
    const twin = buildPersistedPackagePlan({
      pluginId: 'probe-1', packageId: 'pkg-1', sessionId: 'S-a', name: 'k', purpose: 'p', hostCode: HOST, rev: 1,
    })
    // Digesting is stable for one plan object: what was announced can be verified later.
    expect(digestPersistedPlan(base)).toEqual(digestPersistedPlan(base))
    expect(digestPersistedPlan(twin).host).toEqual(digestPersistedPlan(base).host)
    const changed = buildPersistedPackagePlan({
      pluginId: 'probe-1', packageId: 'pkg-1', sessionId: 'S-a', name: 'k', purpose: 'p', hostCode: `${HOST} `, rev: 1,
    })
    expect(digestPersistedPlan(changed).host).not.toEqual(digestPersistedPlan(base).host)
    const bumped = buildPersistedPackagePlan({
      pluginId: 'probe-1', packageId: 'pkg-1', sessionId: 'S-a', name: 'k', purpose: 'p', hostCode: HOST, rev: 2,
    })
    // A revision bump changes the manifest even when the source bytes repeat.
    expect(digestPersistedPlan(bumped).manifest).not.toEqual(digestPersistedPlan(base).manifest)
  })

  it('refuses to build plans around unsafe ids', () => {
    expect(() => buildPersistedPackagePlan({
      pluginId: '../evil', packageId: 'pkg-1', sessionId: 'S-a', name: 'k', purpose: 'p', hostCode: HOST, rev: 1,
    })).toThrow(/cannot be persisted/)
  })
})

describe('manifest validation at the write boundary', () => {
  it('accepts a freshly rendered manifest', () => {
    expect(validatePersistedManifest(buildManifestObject(planOf(1)))).toBeNull()
  })

  it('rejects non-object manifests and missing identity fields', () => {
    expect(validatePersistedManifest('package.json')).toMatch(/not an object/)
    const noName = buildManifestObject(planOf(1))
    noName.name = 'noslash'
    expect(validatePersistedManifest(noName)).toMatch(/namespace\/name/)
    const badVersion = buildManifestObject(planOf(1))
    badVersion.version = 'not-semver'
    expect(validatePersistedManifest(badVersion)).toMatch(/semver/)
  })

  it('rejects missing compatibility, empty capabilities, and broken sandboxes', () => {
    const noCompatible = buildManifestObject(planOf(1))
    Reflect.deleteProperty(noCompatible.dsh as Record<string, unknown>, 'compatible')
    expect(validatePersistedManifest(noCompatible)).toMatch(/dsh\.compatible/)

    const noCapabilities = buildManifestObject(planOf(1))
    ;(noCapabilities.dsh as Record<string, unknown>).capabilities = []
    expect(validatePersistedManifest(noCapabilities)).toMatch(/no capabilities/)

    const noSandbox = buildManifestObject(planOf(1))
    Reflect.deleteProperty(noSandbox.dsh as Record<string, unknown>, 'sandbox')
    expect(validatePersistedManifest(noSandbox)).toMatch(/sandbox/)

    const badType = buildManifestObject(planOf(1))
    ;((badType.dsh as Record<string, unknown>).sandbox as Record<string, unknown>).type = 'untrusted'
    expect(validatePersistedManifest(badType)).toMatch(/not loadable/)

    const noLimits = buildManifestObject(planOf(1))
    Reflect.deleteProperty((noLimits.dsh as Record<string, unknown>).sandbox as Record<string, unknown>, 'resources')
    expect(validatePersistedManifest(noLimits)).toMatch(/resource limits/)

    const zeroTimeout = buildManifestObject(planOf(1))
    const sandbox = (zeroTimeout.dsh as Record<string, unknown>).sandbox as Record<string, unknown>
    const resources = sandbox.resources as Record<string, unknown>
    resources.timeoutMs = 0
    expect(validatePersistedManifest(zeroTimeout)).toMatch(/resource limits/)
  })

  it('refuses writes whose rendered manifest fails validation or escapes the root', () => {
    const root = mkdtempSync(join(tmpdir(), 'persist-refuse-'))
    try {
      const escaping = { ...planOf(1), dirSuffix: join('..', 'outside') }
      expect(() => writePersistedPackage(root, escaping)).toThrow(/outside the configured plugins root/)
      expect(existsSync(join(root, 'user-persisted'))).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('artifact writing', () => {
  it('writes verbatim source plus manifest and reads back revisions', () => {
    const root = mkdtempSync(join(tmpdir(), 'persist-write-'))
    try {
      expect(inspectExistingPersistedArtifact(root, planOf(1))).toBeUndefined()
      const written = writePersistedPackage(root, planOf(1))
      expect(written.files).toEqual(['package.json', 'host.js'])
      expect(readFileSync(join(written.dir, 'host.js'), 'utf8')).toBe(HOST)
      expect(JSON.parse(readFileSync(join(written.dir, 'package.json'), 'utf8'))).toMatchObject({ version: '0.1.1' })
      expect(inspectExistingPersistedArtifact(root, planOf(1))).toMatchObject({ rev: 1, originSession: 'S-a' })

      // A confirmed re-export replaces the artifact at the next revision.
      writePersistedPackage(root, planOf(2))
      const replaced = JSON.parse(readFileSync(join(written.dir, 'package.json'), 'utf8')) as Record<string, unknown>
      expect(replaced).toMatchObject({ version: '0.1.2' })
      expect(inspectExistingPersistedArtifact(root, planOf(2))?.rev).toBe(2)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('degrades unreadable or foreign prior artifacts to an unknown replace', () => {
    const root = mkdtempSync(join(tmpdir(), 'persist-corrupt-'))
    try {
      writePersistedPackage(root, planOf(1))
      const dir = join(root, 'user-persisted', 'probe-9')
      writeFileSync(join(dir, 'package.json'), '{ not json')
      expect(inspectExistingPersistedArtifact(root, planOf(1))).toEqual({ rev: null })
      writeFileSync(join(dir, 'package.json'), '{"name":"someone-else"}')
      expect(inspectExistingPersistedArtifact(root, planOf(1))).toEqual({ rev: null })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('manifests pass the governance LoadGuard', () => {
  const guard = new LoadGuard()

  /** Project a rendered document the way the boot admission pipeline will, then wrap it. */
  function asGoverned(document: unknown): GovernedPlugin {
    const projected = toGovernanceManifest(document)
    if (projected === null) throw new Error('fixture document lost its identity')
    return { manifest: projected as unknown as GovernedPlugin['manifest'], install: () => {}, uninstall: () => {} }
  }

  it('accepts a freshly generated persisted manifest', async () => {
    const result = await guard.preLoad(asGoverned(buildManifestObject(planOf(1))), '0.0.0')
    expect(result.allowed).toBe(true)
    expect(result.failures.filter(failure => failure.severity === 'error')).toEqual([])
  })

  it('rejects a manifest whose sandbox type was swapped after confirmation', async () => {
    const tampered = buildManifestObject(planOf(1))
    ;((tampered.dsh as Record<string, unknown>).sandbox as Record<string, unknown>).type = 'untrusted'
    const result = await guard.preLoad(asGoverned(tampered), '0.0.0')
    expect(result.allowed).toBe(false)
    expect(result.failures.some(failure => /Invalid sandbox type/.test(failure.message))).toBe(true)
  })

  it('rejects a manifest stripped of capabilities', async () => {
    const stripped = buildManifestObject(planOf(1))
    ;(stripped.dsh as Record<string, unknown>).capabilities = []
    const result = await guard.preLoad(asGoverned(stripped), '0.0.0')
    expect(result.allowed).toBe(false)
  })
})

describe('the two-step persist flow on the service', () => {
  it('prepares without writing, then writes exactly on confirm', async () => {
    const { root, cleanup, runner } = await setupWithRoot()
    try {
      const { pluginId, packageId } = await mountCommitted(runner)
      const summary = runner.requestExport(
        AGENT_A,
        CordisDynamicPluginId(pluginId),
        CordisDynamicPackageId(packageId),
      )
      expect(summary.persistedId).toBe(`user-persisted/${pluginId}`)
      expect(summary.targetDirSuffix).toBe(join('user-persisted', pluginId))
      expect(summary.digests.host).toHaveLength(64)
      expect(summary.digests.manifest).toHaveLength(64)
      expect(summary.replaces).toBeUndefined()

      // Nothing may exist below the root before the human confirms.
      expect(existsSync(root) ? readdirSync(root) : []).toEqual([])

      const receipt = await runner.confirmDynamicExport(AGENT_A, summary.exportId)
      if (!receipt.ok) throw new Error(receipt.message)
      expect(receipt).toMatchObject({
        ok: true,
        pluginId,
        packageId,
        persistedId: `user-persisted/${pluginId}`,
        rev: 1,
        files: ['package.json', 'host.js'],
      })
      // The written artifact matches exactly what the user confirmed.
      expect(receipt.digests).toEqual(summary.digests)
      expect(sha256Hex(readFileSync(join(receipt.dir, 'host.js'), 'utf8'))).toBe(summary.digests.host)
      expect(readFileSync(join(receipt.dir, 'host.js'), 'utf8')).toBe(HOST)
      const manifest = JSON.parse(readFileSync(join(receipt.dir, 'package.json'), 'utf8')) as Record<string, unknown>
      expect(manifest.name).toBe(`user-persisted/${pluginId}`)
    } finally {
      cleanup()
    }
  })

  it('announces matching digests on request and settles resolutions', async () => {
    const { cleanup, runner, gateway } = await setupWithRoot()
    try {
      const { pluginId, packageId } = await mountCommitted(runner)
      const summary = runner.requestExport(AGENT_A, CordisDynamicPluginId(pluginId), CordisDynamicPackageId(packageId))
      const emitted = gateway.events.find(([name]) => name === 'cordis/request-export')?.[1] as typeof summary
      expect(emitted.exportId).toBe(summary.exportId)
      expect(emitted.digests).toEqual(summary.digests)
      expect(emitted.agentId).toBe(AGENT_A.id)

      await runner.rejectDynamicExport(AGENT_A, summary.exportId)
      const resolved = [...gateway.events].reverse().find(([name]) => name === 'cordis/request-export-resolved')?.[1] as { outcome: string }
      expect(resolved.outcome).toBe('rejected')
    } finally {
      cleanup()
    }
  })

  it('leaves zero disk traces when the user rejects', async () => {
    const { root, cleanup, runner } = await setupWithRoot()
    try {
      const { pluginId, packageId } = await mountCommitted(runner)
      const summary = runner.requestExport(AGENT_A, CordisDynamicPluginId(pluginId), CordisDynamicPackageId(packageId))
      await expect(runner.rejectDynamicExport(AGENT_A, summary.exportId)).resolves.toEqual({ ok: true })
      expect(existsSync(join(root, 'user-persisted'))).toBe(false)
    } finally {
      cleanup()
    }
  })

  it('bumps the revision when re-exporting over a confirmed artifact', async () => {
    const { cleanup, runner } = await setupWithRoot()
    try {
      const { pluginId, packageId } = await mountCommitted(runner)
      const first = runner.requestExport(AGENT_A, CordisDynamicPluginId(pluginId), CordisDynamicPackageId(packageId))
      await expect(runner.confirmDynamicExport(AGENT_A, first.exportId)).resolves.toMatchObject({ ok: true, rev: 1 })
      const second = runner.requestExport(AGENT_A, CordisDynamicPluginId(pluginId), CordisDynamicPackageId(packageId))
      expect(second.replaces).toMatchObject({ rev: 1, originSession: AGENT_A.id })
      await expect(runner.confirmDynamicExport(AGENT_A, second.exportId)).resolves.toMatchObject({ ok: true, rev: 2 })
    } finally {
      cleanup()
    }
  })

  it('reports a replacement of unreadable prior artifacts', async () => {
    const { root, cleanup, runner } = await setupWithRoot()
    try {
      const { pluginId, packageId } = await mountCommitted(runner)
      const target = join(root, 'user-persisted', pluginId)
      mkdirSync(target, { recursive: true })
      writeFileSync(join(target, 'package.json'), 'garbage')
      const summary = runner.requestExport(AGENT_A, CordisDynamicPluginId(pluginId), CordisDynamicPackageId(packageId))
      expect(summary.replaces).toEqual({ rev: null })
      await expect(runner.confirmDynamicExport(AGENT_A, summary.exportId)).resolves.toMatchObject({ ok: true })
    } finally {
      cleanup()
    }
  })

  it('refuses requests that are not owned, not current, dual-half, or duplicated', async () => {
    const { cleanup, runner, gateway } = await setupWithRoot()
    try {
      const committed = await mountCommitted(runner)
      expect(() => runner.requestExport(
        AGENT_B,
        CordisDynamicPluginId(committed.pluginId),
        CordisDynamicPackageId(committed.packageId),
      )).toThrow(/no dynamic plugin/)

      const stale = runner.define({
        sessionId: AGENT_A.id,
        plugin: { kind: 'new', idPrefix: 'cold' },
        name: 'never ran',
        purpose: 'defined only',
        code: { host: HOST },
      })
      expect(() => runner.requestExport(
        AGENT_A,
        CordisDynamicPluginId(String(stale.pluginId)),
        CordisDynamicPackageId(String(stale.packageId)),
      )).toThrow(/current version/)

      expect(() => runner.requestExport(AGENT_A, CordisDynamicPluginId('ghost-9'), CordisDynamicPackageId('pkg-404')))
        .toThrow(/no dynamic plugin "ghost-9"/)

      // A client-bearing current version is refused: browser halves do not persist yet.
      gateway.answer = 'approve'
      const dual = runner.define({
        sessionId: AGENT_A.id,
        plugin: { kind: 'new', idPrefix: 'duo' },
        name: 'dual half',
        purpose: 'both halves',
        code: { host: HOST, client: 'return () => {}' },
      })
      await expect(runner.run(AGENT_A, dual.pluginId, dual.packageId, 'run')).resolves.toMatchObject({ ok: true })
      await gateway.answering
      expect(() => runner.requestExport(
        AGENT_A,
        CordisDynamicPluginId(String(dual.pluginId)),
        CordisDynamicPackageId(String(dual.packageId)),
      )).toThrow(/Host-half-only/)

      const pendingFirst = runner.requestExport(
        AGENT_A,
        CordisDynamicPluginId(committed.pluginId),
        CordisDynamicPackageId(committed.packageId),
      )
      expect(() => runner.requestExport(
        AGENT_A,
        CordisDynamicPluginId(committed.pluginId),
        CordisDynamicPackageId(committed.packageId),
      )).toThrow(/pending persist request/)
      await runner.rejectDynamicExport(AGENT_A, pendingFirst.exportId)
    } finally {
      cleanup()
    }
  })

  it('settles each request once and refuses foreign confirmers', async () => {
    const { cleanup, runner } = await setupWithRoot()
    try {
      const { pluginId, packageId } = await mountCommitted(runner)
      const summary = runner.requestExport(AGENT_A, CordisDynamicPluginId(pluginId), CordisDynamicPackageId(packageId))
      await expect(runner.confirmDynamicExport(AGENT_B, summary.exportId))
        .resolves.toMatchObject({ ok: false, reason: 'forbidden-session' })
      await expect(runner.confirmDynamicExport(AGENT_A, summary.exportId)).resolves.toMatchObject({ ok: true })
      await expect(runner.confirmDynamicExport(AGENT_A, summary.exportId))
        .resolves.toMatchObject({ ok: false, reason: 'request-missing' })
      await expect(runner.rejectDynamicExport(AGENT_B, summary.exportId))
        .resolves.toMatchObject({ ok: false, reason: 'request-missing' })
      await expect(runner.rejectDynamicExport(AGENT_A, exportId('export-999')))
        .resolves.toMatchObject({ ok: false, reason: 'request-missing' })
    } finally {
      cleanup()
    }
  })

  it('cancels pending exports when the plugin is undefined', async () => {
    const { root, cleanup, runner, gateway } = await setupWithRoot()
    try {
      const { pluginId, packageId } = await mountCommitted(runner)
      const summary = runner.requestExport(AGENT_A, CordisDynamicPluginId(pluginId), CordisDynamicPackageId(packageId))
      await expect(runner.undefine(AGENT_A, CordisDynamicPluginId(pluginId))).resolves.toMatchObject({ ok: true })
      const resolved = [...gateway.events]
        .reverse()
        .find(([name]) => name === 'cordis/request-export-resolved')?.[1] as { outcome: string }
      expect(resolved.outcome).toBe('cancelled')
      await expect(runner.confirmDynamicExport(AGENT_A, summary.exportId))
        .resolves.toMatchObject({ ok: false, reason: 'request-missing' })
      expect(existsSync(root) ? readdirSync(root) : []).toEqual([])
    } finally {
      cleanup()
    }
  })
})
