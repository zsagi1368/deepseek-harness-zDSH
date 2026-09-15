/**
 * Factory preinstall suite (TC-B1-1.2b): the seed whitelist parser, the
 * zero-action passthrough for an empty seed, the idempotent per-entry state
 * machine (first install then restart → byte-identical ledger), the uninstall
 * tombstone that stops resurrection, and the P2 regression (a storage-only
 * npm install is reachable again after a restart so it can be uninstalled and
 * its extracted tree reclaimed).
 *
 * The install-channel fixtures reuse the same in-memory registry double +
 * npm-pack-shaped tarball that the sibling npm-install suite uses (TEST-b0
 * probe semantics), so the `npm:` branch of the state machine is exercised
 * against a transport double, never the network.
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import PluginGovernanceGateway, { type PluginGovernanceId } from '../src/index.ts'
import type { HttpLike } from '../src/install/registry-source.ts'
import { parseSeedManifest, SEED_SCHEMA_VERSION } from '../src/preinstall/seed.ts'

const storageRoots: string[] = []
const dirs: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of storageRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

/** Brand a raw id for gateway calls. */
function gid(value: string): PluginGovernanceId {
  return value as PluginGovernanceId
}

/** A throwaway directory registered for cleanup. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'preinstall-'))
  dirs.push(dir)
  return dir
}

// ---- npm-pack-shaped tarball + registry double (mirrors npm-install.spec) ----

function tarHeader(name: string, size: number, typeflag: string): Buffer {
  const header = Buffer.alloc(512, 0)
  header.write(name.slice(0, 100), 0, 'latin1')
  header.write('0000644\0', 100, 'latin1')
  header.write('0000000\0', 108, 'latin1')
  header.write('0000000\0', 116, 'latin1')
  header.write(`${size.toString(8).padStart(11, '0')}\0`, 124, 'latin1')
  header.write('00000000000\0', 136, 'latin1')
  header.write(typeflag.slice(0, 1), 156, 'latin1')
  header.write('ustar\0', 257, 'latin1')
  header.write('00', 263, 'latin1')
  let checksum = 0
  for (let index = 0; index < 512; index += 1) {
    checksum += index >= 148 && index < 156 ? 0x20 : header.readUInt8(index)
  }
  header.write(`${checksum.toString(8).padStart(7, '0')}\0`, 148, 'latin1')
  return header
}

function buildNpmTar(entries: Array<{ name: string; data?: string }>): Buffer {
  const chunks: Buffer[] = []
  for (const entry of entries) {
    const stored = entry.name.startsWith('package/') ? entry.name : `package/${entry.name}`
    const data = Buffer.from(entry.data ?? '', 'utf8')
    chunks.push(tarHeader(stored, data.length, '0'))
    chunks.push(data)
    const padding = (512 - (data.length % 512)) % 512
    if (padding > 0) chunks.push(Buffer.alloc(padding))
  }
  chunks.push(Buffer.alloc(1024))
  return Buffer.concat(chunks)
}

/** The `@demo/plugin` publish tarball (npm: fixture). */
function npmDemoTarball(): Buffer {
  return buildNpmTar([{
    name: 'package/package.json',
    data: JSON.stringify({
      name: '@demo/plugin',
      version: '1.0.0',
      displayName: 'Demo Plugin',
      dsh: { compatible: '>=0.0.0', capabilities: [{ type: 'tool', tool: { name: 'demo_tool', description: 'fixture', schema: { type: 'object' } } }] },
    }),
  }])
}

function packument(origin: string, version: string, tarball: Buffer): Buffer {
  return Buffer.from(JSON.stringify({
    'dist-tags': { latest: version },
    versions: {
      [version]: {
        name: '@demo/plugin',
        version,
        dist: {
          tarball: `${origin}/demo/plugin/-/plugin-${version}.tgz`,
          integrity: `sha512-${createHash('sha512').update(tarball).digest('base64')}`,
        },
      },
    },
  }))
}

/** An in-memory registry double for `@demo/plugin@1.0.0` at https origin. */
function registryDouble(): HttpLike {
  const origin = 'https://registry.test'
  const tarball = npmDemoTarball()
  const routes: Record<string, { body: Buffer; contentType: string }> = {
    '/demo/plugin': { body: packument(origin, '1.0.0', tarball), contentType: 'application/json' },
    '/demo/plugin/-/plugin-1.0.0.tgz': { body: tarball, contentType: 'application/x-tar' },
  }
  return async (url) => {
    const route = routes[new URL(url).pathname] ?? { body: Buffer.alloc(0), contentType: 'application/json' }
    return new Response(new Uint8Array(route.body), {
      status: route.body.length === 0 ? 404 : 200,
      headers: { 'content-length': String(route.body.length), 'content-type': route.contentType },
    })
  }
}

// ---- seed / local fixtures ----

/** A local plugin directory carrying a valid `dsh` manifest. */
function localPluginDir(name: string): string {
  const dir = scratch()
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name,
    version: '1.0.0',
    displayName: 'Demo Local',
    dsh: {
      autoApprove: true,
      compatible: '>=0.0.0',
      capabilities: [{ type: 'tool', tool: { name: 'demo_local_tool', description: 'fixture', schema: { type: 'object' } } }],
    },
  }))
  return dir
}

/** Write a seed manifest to a scratch dir and return its path. */
function writeSeed(entries: unknown[], extra: Record<string, unknown> = {}): string {
  const path = join(scratch(), 'seed.json')
  writeFileSync(path, JSON.stringify({ version: SEED_SCHEMA_VERSION, entries, ...extra }))
  return path
}

interface Boot {
  gateway: PluginGovernanceGateway
  storageRoot: string
  resultsPath: string
}

/** Construct a gateway over `storageRoot`, run its service init, return handles. */
async function boot(options: { storageRoot?: string; seedPath?: string; http?: HttpLike } = {}): Promise<Boot> {
  const ctx = new Context()
  contexts.push(ctx)
  const storageRoot = options.storageRoot ?? mkdtempSync(join(tmpdir(), 'gov-store-'))
  storageRoots.push(storageRoot)
  const gateway = new PluginGovernanceGateway(
    ctx,
    {
      storageRoot,
      registryUrl: 'https://registry.test',
      ...(options.seedPath === undefined ? {} : { seedPath: options.seedPath }),
    },
    undefined,
    { http: options.http ?? registryDouble() },
  )
  const self = gateway as unknown as Record<symbol, () => Promise<void>>
  await self[Service.init]!.call(self)
  return { gateway, storageRoot, resultsPath: join(storageRoot, 'data', 'preinstall-results.json') }
}

// ============================================================================

describe('parseSeedManifest (field whitelist, reviewer 建议②)', () => {
  it('passes an empty entries list straight through (zero actions)', () => {
    const parsed = parseSeedManifest({ version: SEED_SCHEMA_VERSION, entries: [] })
    expect(parsed.entries).toEqual([])
  })

  it('ignores explanatory prose fields and consumes only the whitelist', () => {
    const parsed = parseSeedManifest({
      version: SEED_SCHEMA_VERSION,
      $comment: 'prose the parser must never read',
      entryFields: { id: 'docs', source: 'docs' },
      generatedAt: '2026-01-01T00:00:00Z',
      entries: [{
        id: 'demo/local',
        package: '@demo/local',
        version: '1.0.0',
        pin: 'a'.repeat(40),
        source: 'local:node_modules/@demo/local',
        integrity: null,
        enabledAtBoot: true,
        family: 'demo',
        failPolicy: 'fail-open',
        someFutureProseField: 'ignored',
      }],
    })
    expect(parsed.entries).toHaveLength(1)
    expect(parsed.entries[0]).toEqual({
      id: 'demo/local',
      package: '@demo/local',
      version: '1.0.0',
      pin: 'a'.repeat(40),
      source: 'local:node_modules/@demo/local',
      integrity: null,
      enabledAtBoot: true,
      family: 'demo',
      failPolicy: 'fail-open',
    })
    expect(parsed.entries[0]).not.toHaveProperty('someFutureProseField')
  })

  it('drops entries missing id/source or using an unrecognised source scheme', () => {
    const parsed = parseSeedManifest({
      version: SEED_SCHEMA_VERSION,
      entries: [
        { id: 'demo/x' },
        { source: 'npm:@demo/y' },
        { id: 'demo/z', source: 'git:whatever' },
        { id: 'demo/ok', source: 'npm:@demo/ok@1.0.0' },
        'not-an-object',
      ],
    })
    expect(parsed.entries.map(e => e.id)).toEqual(['demo/ok'])
  })

  it('treats a wrong-version or non-object document as zero entries (fail-open)', () => {
    expect(parseSeedManifest({ version: 99, entries: [{ id: 'demo/a', source: 'npm:x' }] }).entries).toEqual([])
    expect(parseSeedManifest(null).entries).toEqual([])
    expect(parseSeedManifest('nope').entries).toEqual([])
  })
})

describe('SeedPreinstaller through the gateway', () => {
  it('is a zero-action passthrough for an empty seed: no ledger file is created', async () => {
    const { gateway, resultsPath } = await boot({ seedPath: writeSeed([]) })
    await gateway.settlePreinstall()
    expect(gateway.preinstallReport().entries).toEqual({})
    expect(existsSync(resultsPath)).toBe(false)
  })

  it('installs local:+npm: on first boot, then is a no-op on restart with a byte-identical ledger', async () => {
    const localDir = localPluginDir('@demo/local')
    const seedPath = writeSeed([
      { id: 'demo/local', package: '@demo/local', version: '1.0.0', pin: 'b'.repeat(40), source: `local:${localDir}`, integrity: null, enabledAtBoot: true, family: 'demo', failPolicy: 'fail-open' },
      { id: 'demo/plugin', package: '@demo/plugin', version: '1.0.0', pin: 'c'.repeat(40), source: 'npm:@demo/plugin@1.0.0', integrity: null, enabledAtBoot: false, family: 'demo', failPolicy: 'fail-open' },
    ])
    const storageRoot = mkdtempSync(join(tmpdir(), 'gov-store-'))
    storageRoots.push(storageRoot)

    // First boot installs both entries.
    const boot1 = await boot({ storageRoot, seedPath })
    await boot1.gateway.settlePreinstall()
    const report1 = boot1.gateway.preinstallReport()
    expect(report1.entries['demo/local']?.status).toBe('installed')
    expect(report1.entries['demo/plugin']?.status).toBe('installed')
    const bytes1 = readFileSync(boot1.resultsPath, 'utf8')
    for (const id of ['demo/local', 'demo/plugin']) {
      expect(boot1.gateway.list().plugins.some(p => p.pluginId === gid(id))).toBe(true)
    }

    // Restart over the same storage: no-op, ledger byte-identical, roster intact.
    const boot2 = await boot({ storageRoot, seedPath })
    await boot2.gateway.settlePreinstall()
    expect(readFileSync(boot2.resultsPath, 'utf8')).toBe(bytes1)
    const report2 = boot2.gateway.preinstallReport()
    expect(report2.entries).toEqual(report1.entries)
    for (const id of ['demo/local', 'demo/plugin']) {
      expect(boot2.gateway.list().plugins.some(p => p.pluginId === gid(id))).toBe(true)
    }
  })

  it('records a tombstone on uninstall and never reinstalls the entry on restart', async () => {
    const localDir = localPluginDir('@demo/local')
    const seedPath = writeSeed([
      { id: 'demo/local', package: '@demo/local', version: '1.0.0', pin: 'b'.repeat(40), source: `local:${localDir}`, integrity: null, enabledAtBoot: true, family: 'demo', failPolicy: 'fail-open' },
    ])
    const storageRoot = mkdtempSync(join(tmpdir(), 'gov-store-'))
    storageRoots.push(storageRoot)

    const boot1 = await boot({ storageRoot, seedPath })
    await boot1.gateway.settlePreinstall()
    expect(boot1.gateway.preinstallReport().entries['demo/local']?.status).toBe('installed')

    // Operator uninstalls the preinstalled entry → tombstone.
    const removed = await boot1.gateway.uninstall({ pluginId: gid('demo/local') })
    expect(removed.ok).toBe(true)
    const afterUninstall = boot1.gateway.preinstallReport().entries['demo/local']
    expect(afterUninstall?.userUninstalled).toBe(true)
    expect(afterUninstall?.status).toBe('skipped')

    // A later boot must NOT resurrect it.
    const boot2 = await boot({ storageRoot, seedPath })
    await boot2.gateway.settlePreinstall()
    expect(boot2.gateway.preinstallReport().entries['demo/local']?.userUninstalled).toBe(true)
    expect(boot2.gateway.list().plugins.some(p => p.pluginId === gid('demo/local'))).toBe(false)
  })

  it('records a fail-open row for a broken entry and still installs the rest', async () => {
    const missingDir = join(scratch(), 'does-not-exist')
    const localDir = localPluginDir('@demo/local')
    const seedPath = writeSeed([
      { id: 'demo/local', package: '@demo/local', version: '1.0.0', pin: 'b'.repeat(40), source: `local:${localDir}`, integrity: null, enabledAtBoot: true, family: 'demo', failPolicy: 'fail-open' },
      { id: 'demo/broken', package: '@demo/broken', version: '1.0.0', pin: 'd'.repeat(40), source: `local:${missingDir}`, integrity: null, enabledAtBoot: true, family: 'demo', failPolicy: 'fail-open' },
    ])
    const { gateway } = await boot({ seedPath })
    await gateway.settlePreinstall()
    const report = gateway.preinstallReport()
    expect(report.entries['demo/local']?.status).toBe('installed')
    expect(report.entries['demo/broken']?.status).toBe('failed')
    expect(report.entries['demo/broken']?.reason).toBeTruthy()
  })
})

describe('P2 regression — storage-only uninstall reachable after restart', () => {
  it('rebuilds the roster from storage so a restarted npm install uninstalls and reclaims its tree', async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), 'gov-store-'))
    storageRoots.push(storageRoot)
    const installDir = join(storageRoot, 'installed', 'demo', 'plugin')

    // Boot 1: install via the npm channel (no seed involvement), then "power off".
    const boot1 = await boot({ storageRoot })
    const installed = await boot1.gateway.install({ source: 'npm:@demo/plugin@1.0.0' })
    expect(installed.ok).toBe(true)
    expect(existsSync(join(installDir, 'package.json'))).toBe(true)

    // Boot 2 over the same storage: pre-fix this entry was invisible and the
    // tree was orphaned; with the fix the roster is rebuilt and uninstall works.
    const boot2 = await boot({ storageRoot })
    expect(boot2.gateway.list().plugins.some(p => p.pluginId === gid('demo/plugin'))).toBe(true)
    const removed = await boot2.gateway.uninstall({ pluginId: gid('demo/plugin') })
    expect(removed.ok).toBe(true)
    expect(boot2.gateway.list().plugins.some(p => p.pluginId === gid('demo/plugin'))).toBe(false)
    expect(existsSync(installDir)).toBe(false)
  })
})
