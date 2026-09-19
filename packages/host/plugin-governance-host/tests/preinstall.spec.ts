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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import PluginGovernanceGateway, { type PluginGovernanceId } from '../src/index.ts'
import type { HttpLike } from '../src/install/registry-source.ts'
import {
  parseSeedManifest,
  seedEntryContractIssue,
  SEED_SCHEMA_VERSION,
  SUPPORTED_FAIL_POLICY,
} from '../src/preinstall/seed.ts'

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
      // S2 made `npm:` integrity mandatory; the seed now carries the `sha512-`
      // prefix (the executor's own guard, checked before the install channel
      // resolves the tarball against the registry's stated digest).
      { id: 'demo/plugin', package: '@demo/plugin', version: '1.0.0', pin: 'c'.repeat(40), source: 'npm:@demo/plugin@1.0.0', integrity: `sha512-${'A'.repeat(88)}=`, enabledAtBoot: false, family: 'demo', failPolicy: 'fail-open' },
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

// ============================================================================
// TC-B3-MM1b — restart boot-posture drift regression (filehub intake, 主线
// Gate-P 实测暴露)：SeedPreinstaller 的 requestBootState(false) 只在 install
// pass 行变更（`else if (changed)`）时触发；重启路径里 local: 工件被
// admitManifest 以默认 ACTIVE 复准入（该 id 此刻尚未注册，init sync 尾部的
// restorePersistedDecisions 只能把 'disabled' 决策留在队列里），于是
// enabledAtBoot=false 的件第二次 boot 漂移成 active，且 install 尾部的
// persistence.save() 把首启落盘的 'disabled' 持久行覆写回 active。
// 用例①锁死「seed=false+本体默认 enabled」型的两启一致；用例②锁死修复的
// 反向边界——用户手动 enable 过的 seed=false 件，决策优先于 seed，重启保
// active（防「pass 内无条件补 disable」式过度修复）。
// ============================================================================
describe('TC-B3-MM1b regression — enabledAtBoot=false local: posture survives restarts', () => {
  /** filehub 形态：local: + autoApprove（准入默认 ACTIVE）+ seed 姿态 false。 */
  function falseSeed(): { seedPath: string; localDir: string } {
    const localDir = localPluginDir('@demo/off')
    const seedPath = writeSeed([{
      id: 'demo/off',
      package: '@demo/off',
      version: '1.0.0',
      pin: 'e'.repeat(40),
      source: `local:${localDir}`,
      integrity: null,
      enabledAtBoot: false,
      family: 'demo',
      failPolicy: 'fail-open',
    }])
    return { seedPath, localDir }
  }

  it('seed=false 件两次 boot 姿态一致 disabled，台账逐字节且持久决策面不被复写', async () => {
    const { seedPath } = falseSeed()
    const storageRoot = mkdtempSync(join(tmpdir(), 'gov-store-'))
    storageRoots.push(storageRoot)

    const boot1 = await boot({ storageRoot, seedPath })
    await boot1.gateway.settlePreinstall()
    expect(boot1.gateway.list().plugins.find(p => p.pluginId === gid('demo/off'))?.status).toBe('disabled')
    const bytes1 = readFileSync(boot1.resultsPath, 'utf8')

    const boot2 = await boot({ storageRoot, seedPath })
    await boot2.gateway.settlePreinstall()
    // 修复前红灯点：boot-2 复准入停在 ACTIVE（漂移），此处应为 disabled。
    expect(boot2.gateway.list().plugins.find(p => p.pluginId === gid('demo/off'))?.status).toBe('disabled')
    // §9.4 restart byte-identity 纪律保持：preinstall 台账一毫不差。
    expect(readFileSync(boot2.resultsPath, 'utf8')).toBe(bytes1)
    // 首启落盘的 false 持久决策（registry.json 行）不得被 boot-2 install 的
    // save 覆写回 active——否则第三次重启连磁盘记忆都是错的。
    const snapshot = JSON.parse(readFileSync(join(storageRoot, 'registry.json'), 'utf8')) as {
      plugins: Array<{ id: string; status: string }>
    }
    expect(snapshot.plugins.find(plugin => plugin.id === 'demo/off')?.status).toBe('disabled')

    // 第三次 boot：修复前磁盘记忆已被 boot-2 复写为 active，新进程构造期读回的
    // 就是错记忆 → 漂移由「暂态」固化成「永久态」（主线真网关实测即此形态；无
    // Loader 的本 harness 里 boot-2 的内存态被同步 restore 尾扫掩盖，有 Loader 的
    // 真网关里首次 list() 读到的就是 ACTIVE）。修复后必须仍 disabled。
    const boot3 = await boot({ storageRoot, seedPath })
    await boot3.gateway.settlePreinstall()
    expect(boot3.gateway.list().plugins.find(p => p.pluginId === gid('demo/off'))?.status).toBe('disabled')
    expect(readFileSync(boot3.resultsPath, 'utf8')).toBe(bytes1)
  })

  it('用户手动 enable 过 seed=false 件后重启保 active（决策优先于 seed）', async () => {
    const { seedPath } = falseSeed()
    const storageRoot = mkdtempSync(join(tmpdir(), 'gov-store-'))
    storageRoots.push(storageRoot)

    const boot1 = await boot({ storageRoot, seedPath })
    await boot1.gateway.settlePreinstall()
    expect(boot1.gateway.list().plugins.find(p => p.pluginId === gid('demo/off'))?.status).toBe('disabled')
    expect((await boot1.gateway.enable({ pluginId: gid('demo/off') })).ok).toBe(true)

    // boot-2/3：用户的 active 决策必须压过 seed 的 false 姿态并保持。
    for (const round of [2, 3]) {
      const again = await boot({ storageRoot, seedPath })
      await again.gateway.settlePreinstall()
      expect(again.gateway.list().plugins.find(p => p.pluginId === gid('demo/off'))?.status, `boot-${round}`).toBe('active')
    }
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

// ============================================================================
// EXEC7 三修回归（TC-B1-1.3b 任务1 / 续跑卡 TC-B1-1.3c）：
//   S1 墓碑前置于树删除 — 卸载写墓碑失败时整单回滚、绝不留下"卸载成功却无
//      墓碑→下一轮复活"的半态；
//   S2 failPolicy 非法值显式拒绝 + npm: 强制 sha512 integrity — 执行器把无法
//      兑现的条目落成 failed 行，绝不静默降级为自己的默认；
//   S3 provenance schema 增量 — factory local: 行标 'preinstall'、source 投影仍
//      native、可跨重启由 readInstalledSource 载入，且永不删其 node_modules 树。
// ============================================================================

describe('EXEC7 S2 — seedEntryContractIssue rejects what the executor cannot honor', () => {
  const base = {
    id: 'demo/local', package: '@demo/local', version: '1.0.0', pin: 'b'.repeat(40),
    integrity: null as string | null, enabledAtBoot: false, family: 'demo',
  }

  it('honors the only implemented failPolicy', () => {
    expect(seedEntryContractIssue({ ...base, source: 'local:node_modules/@demo/local', failPolicy: SUPPORTED_FAIL_POLICY })).toBeNull()
  })

  it('rejects a non-fail-open posture instead of laundering it into the default', () => {
    const reason = seedEntryContractIssue({ ...base, source: 'local:node_modules/@demo/local', failPolicy: 'fail-closed' })
    expect(reason).toMatch(/failPolicy/)
    expect(reason).toMatch(/fail-open/)
  })

  it('rejects an npm: source missing its mandatory sha512 integrity', () => {
    const reason = seedEntryContractIssue({ ...base, source: 'npm:@demo/plugin@1.0.0', integrity: null, failPolicy: SUPPORTED_FAIL_POLICY })
    expect(reason).toMatch(/integrity/)
    expect(reason).toMatch(/sha512/)
  })

  it('honors an npm: source that declares a sha512 integrity', () => {
    expect(seedEntryContractIssue({ ...base, source: 'npm:@demo/plugin@1.0.0', integrity: `sha512-${'A'.repeat(88)}=`, failPolicy: SUPPORTED_FAIL_POLICY })).toBeNull()
  })

  it('surfaces a present-but-invalid failPolicy as an invalid marker, not the default', () => {
    const parsed = parseSeedManifest({
      version: SEED_SCHEMA_VERSION,
      entries: [{ ...base, source: 'local:node_modules/@demo/local', failPolicy: 123 }],
    })
    expect(parsed.entries[0]?.failPolicy).toBe('invalid:number')
    expect(seedEntryContractIssue(parsed.entries[0]!)).toMatch(/failPolicy/)
  })
})

describe('EXEC7 S1 + S2 + S3 through the gateway', () => {
  it('S2: records a failed row for an unimplemented failPolicy and never installs it', async () => {
    const localDir = localPluginDir('@demo/local')
    const seedPath = writeSeed([
      { id: 'demo/local', package: '@demo/local', version: '1.0.0', pin: 'b'.repeat(40), source: `local:${localDir}`, integrity: null, enabledAtBoot: true, family: 'demo', failPolicy: 'fail-closed' },
    ])
    const { gateway } = await boot({ seedPath })
    await gateway.settlePreinstall()
    const report = gateway.preinstallReport()
    expect(report.entries['demo/local']?.status).toBe('failed')
    expect(report.entries['demo/local']?.reason).toMatch(/failPolicy/)
    // Rejected before install: never reached the roster.
    expect(gateway.list().plugins.some(p => p.pluginId === gid('demo/local'))).toBe(false)
  })

  it('S2: records a failed row for an npm: entry without sha512 integrity and never installs it', async () => {
    const seedPath = writeSeed([
      { id: 'demo/plugin', package: '@demo/plugin', version: '1.0.0', pin: 'c'.repeat(40), source: 'npm:@demo/plugin@1.0.0', integrity: null, enabledAtBoot: false, family: 'demo', failPolicy: 'fail-open' },
    ])
    const { gateway } = await boot({ seedPath })
    await gateway.settlePreinstall()
    const report = gateway.preinstallReport()
    expect(report.entries['demo/plugin']?.status).toBe('failed')
    expect(report.entries['demo/plugin']?.reason).toMatch(/integrity/)
    expect(gateway.list().plugins.some(p => p.pluginId === gid('demo/plugin'))).toBe(false)
  })

  it('S1: fails the uninstall and keeps the plugin registered when the tombstone write cannot commit', async () => {
    const localDir = localPluginDir('@demo/local')
    const seedPath = writeSeed([
      { id: 'demo/local', package: '@demo/local', version: '1.0.0', pin: 'b'.repeat(40), source: `local:${localDir}`, integrity: null, enabledAtBoot: true, family: 'demo', failPolicy: 'fail-open' },
    ])
    const storageRoot = mkdtempSync(join(tmpdir(), 'gov-store-'))
    storageRoots.push(storageRoot)
    const boot1 = await boot({ storageRoot, seedPath })
    await boot1.gateway.settlePreinstall()
    expect(boot1.gateway.preinstallReport().entries['demo/local']?.status).toBe('installed')

    // Inject a tombstone-write failure — the durable stand-in for the K-B1
    // writer-lock timeout / disk error the S1 fix targets. Only recordUninstall
    // throws; the earlier persistence.save() still runs, isolating the S1 branch.
    const preinstaller = (boot1.gateway as unknown as {
      preinstaller: { recordUninstall: (id: string) => Promise<boolean> }
    }).preinstaller
    preinstaller.recordUninstall = async () => { throw new Error('injected writer-lock failure') }

    const removed = await boot1.gateway.uninstall({ pluginId: gid('demo/local') })
    expect(removed.ok).toBe(false)
    if (!removed.ok) expect(removed.error.code).toBe('persistence-failed')
    // Compensation: the plugin stays registered, so there is no
    // "uninstall OK + no tombstone" half-state a later pass would resurrect.
    expect(boot1.gateway.list().plugins.some(p => p.pluginId === gid('demo/local'))).toBe(true)
    // The durable ledger is untouched: still installed, no tombstone row.
    const ledger = JSON.parse(readFileSync(boot1.resultsPath, 'utf8')) as {
      entries: Record<string, { status: string; userUninstalled?: boolean }>
    }
    expect(ledger.entries['demo/local']?.status).toBe('installed')
    expect(ledger.entries['demo/local']?.userUninstalled).toBeUndefined()
  })

  it('P-9b: the preinstall half keeps the fatal semantics after the narrowing (no warn fallback, no half-state)', async () => {
    // P-9b (DESIGN §1.2 [P-9b 附裁]) narrows the fatal tombstone write to
    // `provenance=preinstall` rows only; the sibling npm case in
    // npm-install.spec.ts covers the non-preinstall fallback. This is the pair
    // regression proving the narrowing did NOT touch the load-bearing half:
    // the same injected writer-lock failure must still fail the receipt, and
    // a later boot must find the plugin exactly where the failed uninstall
    // left it (registered, un-tombstoned) — never a silently-demoted
    // "uninstall OK + no tombstone" state a later pass would resurrect.
    const localDir = localPluginDir('@demo/local')
    const seedPath = writeSeed([
      { id: 'demo/local', package: '@demo/local', version: '1.0.0', pin: 'b'.repeat(40), source: `local:${localDir}`, integrity: null, enabledAtBoot: true, family: 'demo', failPolicy: 'fail-open' },
    ])
    const storageRoot = mkdtempSync(join(tmpdir(), 'gov-store-'))
    storageRoots.push(storageRoot)
    const boot1 = await boot({ storageRoot, seedPath })
    await boot1.gateway.settlePreinstall()
    expect(boot1.gateway.preinstallReport().entries['demo/local']?.status).toBe('installed')
    // The fatal half is decided by the provenance row, so pin the precondition.
    const rows = [...(boot1.gateway as unknown as { installedSources: Map<string, Record<string, unknown>> }).installedSources.values()]
    expect(rows.find(r => r.kind === 'preinstall')).toBeDefined()

    const warnings: string[] = []
    const internals = boot1.gateway as unknown as {
      preinstaller: { recordUninstall: (id: string) => Promise<boolean> }
      warn(message: string): void
    }
    internals.warn = (message) => { warnings.push(message) }
    internals.preinstaller.recordUninstall = async () => { throw new Error('injected writer-lock failure') }

    const removed = await boot1.gateway.uninstall({ pluginId: gid('demo/local') })
    expect(removed.ok).toBe(false)
    if (!removed.ok) expect(removed.error.code).toBe('persistence-failed')
    expect(boot1.gateway.list().plugins.some(p => p.pluginId === gid('demo/local'))).toBe(true)
    // The preinstall half must not silently demote to the P-9b warn fallback.
    expect(warnings.filter(w => w.includes('tombstone'))).toHaveLength(0)

    // Restart over the same home: the ledger still says `installed` with no
    // tombstone and the plugin is admitted again — the failed uninstall
    // committed nothing, so continuity, not resurrection, is what holds.
    const boot2 = await boot({ storageRoot, seedPath })
    await boot2.gateway.settlePreinstall()
    expect(boot2.gateway.list().plugins.some(p => p.pluginId === gid('demo/local'))).toBe(true)
    const ledger = JSON.parse(readFileSync(boot2.resultsPath, 'utf8')) as {
      entries: Record<string, { status: string; userUninstalled?: boolean }>
    }
    expect(ledger.entries['demo/local']?.status).toBe('installed')
    expect(ledger.entries['demo/local']?.userUninstalled).toBeUndefined()
  })

  it('S3: badges a local: preinstall row, survives a restart, and never deletes the artifact tree', async () => {
    const localDir = localPluginDir('@demo/local')
    const seedPath = writeSeed([
      { id: 'demo/local', package: '@demo/local', version: '1.0.0', pin: 'b'.repeat(40), source: `local:${localDir}`, integrity: null, enabledAtBoot: true, family: 'webstack', failPolicy: 'fail-open' },
    ])
    const storageRoot = mkdtempSync(join(tmpdir(), 'gov-store-'))
    storageRoots.push(storageRoot)
    const boot1 = await boot({ storageRoot, seedPath })
    await boot1.gateway.settlePreinstall()

    const summary1 = boot1.gateway.list().plugins.find(p => p.pluginId === gid('demo/local'))
    expect(summary1).toBeDefined()
    expect((summary1 as unknown as { provenance?: string }).provenance).toBe('preinstall')
    // Source projection stays native (admission went through admitManifest).
    expect((summary1 as unknown as { source: string }).source).toBe('native')

    // The durable row is kind preinstall and carries NO dir by design.
    const installedLedger = JSON.parse(readFileSync(join(storageRoot, 'data', 'installed-sources.json'), 'utf8')) as {
      sources: Record<string, Record<string, unknown>>
    }
    expect(installedLedger.sources['demo/local']?.kind).toBe('preinstall')
    expect(installedLedger.sources['demo/local']).not.toHaveProperty('dir')

    // Restart: readInstalledSource must hydrate the preinstall row back.
    const boot2 = await boot({ storageRoot, seedPath })
    const rows2 = [...(boot2.gateway as unknown as { installedSources: Map<string, Record<string, unknown>> }).installedSources.values()]
    const preRow = rows2.find(r => r.kind === 'preinstall')
    expect(preRow).toBeDefined()
    expect(preRow).not.toHaveProperty('dir')
    await boot2.gateway.settlePreinstall()
    const summary2 = boot2.gateway.list().plugins.find(p => p.pluginId === gid('demo/local'))
    expect((summary2 as unknown as { provenance?: string }).provenance).toBe('preinstall')

    // A successful uninstall drops only the ledger row — the artifact dir (the
    // node_modules closure stand-in) must survive untouched.
    const removed = await boot2.gateway.uninstall({ pluginId: gid('demo/local') })
    expect(removed.ok).toBe(true)
    expect(existsSync(join(localDir, 'package.json'))).toBe(true)
  })

  it('S3: readInstalledSource hydrates npm+preinstall rows and drops foreign/incomplete shapes', async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), 'gov-store-'))
    storageRoots.push(storageRoot)
    const dataDir = join(storageRoot, 'data')
    mkdirSync(dataDir, { recursive: true })
    writeFileSync(join(dataDir, 'installed-sources.json'), JSON.stringify({
      version: 1,
      sources: {
        'npm/ok': { kind: 'npm', spec: 'npm:@demo/ok@1.0.0', version: '1.0.0', installedAt: 1, dir: join(storageRoot, 'installed', 'demo', 'ok') },
        'pre/ok': { kind: 'preinstall', spec: 'local:node_modules/@demo/pre', version: '2.0.0', installedAt: 2 },
        'bad/foreign': { kind: 'weird', spec: 'x', version: '1', installedAt: 3 },
        'bad/npm-nodir': { kind: 'npm', spec: 's', version: 'v', installedAt: 4 },
        'bad/pre-nonnumeric-at': { kind: 'preinstall', spec: 'local:y', version: '1', installedAt: 'nope' },
      },
    }))
    // A seedless boot still hydrates the ledger once at init (loadInstalledSources).
    const { gateway } = await boot({ storageRoot, seedPath: writeSeed([]) })
    const rows = [...(gateway as unknown as { installedSources: Map<string, Record<string, unknown>> }).installedSources.values()]
    // 2 well-formed rows survive; the 3 malformed shapes are dropped.
    expect(rows.length).toBe(2)
    const npm = rows.find(r => r.kind === 'npm')
    const pre = rows.find(r => r.kind === 'preinstall')
    expect(typeof npm?.dir).toBe('string')
    expect(pre).toBeDefined()
    expect(pre).not.toHaveProperty('dir')
    expect(rows.some(r => r.installedAt === 'nope')).toBe(false)
  })
})
