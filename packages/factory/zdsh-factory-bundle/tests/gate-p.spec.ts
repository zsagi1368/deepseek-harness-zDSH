/**
 * Gate-P / Gate-M factory matrix — three artifacts (TC-B1-1.3b task 5, 续跑 TC-B1-1.3c;
 * P4 真 import 探针 by TC-B2-S1b; parameterized into a per-seed-row matrix by
 * TC-B2-2.1b, extended to a third row by TC-B2-2.2b: the factory-off
 * `core/webstack-verticals` pilot + the boot-enabled `core/omnivision` and
 * `core/webstack-bridge` entries).
 *
 * This is the factory's OWN self-managed test surface (DESIGN-intake-tech.md §6
 * Gate-P row: "新 packages/factory（自管面）+ 根 vitest run"). It drives the real
 * governance gateway against the REAL repository seed (`zdsh-factory/seed.json`)
 * and the REAL cold-installed artifacts under
 * `packages/factory/zdsh-factory-bundle/node_modules/...`, over a throwaway
 * storage root standing in for a fresh `DSH_HOME`.
 *
 * Note on placement: the root vitest lane glob covers package tests at the path
 * form "packages/<group>/<package>/tests", which has no rule for a two-level
 * "packages/factory/tests", and the design forbids standing up a new lane /
 * editing the shared vitest config — so the matrix lives inside the bundle
 * package ("packages/factory/zdsh-factory-bundle/tests", the same self-managed
 * assembly) and still runs under the existing "pnpm vitest run".
 *
 * What it proves (the batch-2 acceptance slice, per seed row):
 *  - P1 first boot: every seed row is admitted, appears in list(), lands the
 *    boot posture the seed ITSELF declares (`enabledAtBoot` → 'active', else
 *    the K-B2 DEFAULT-DISABLED check), and badges provenance 'preinstall' +
 *    source native. The verticals row is the disabled case; the omnivision row
 *    is the boot-enabled case (出厂即用功能件, TC-B2-2.1b).
 *  - P1 idempotency: a restart over the same home re-settles to a
 *    byte-identical result ledger covering BOTH rows (逐字节), and both roster
 *    postures survive.
 *  - M1 lifecycle (verticals pilot, unchanged): disabled → still disabled on
 *    restart → uninstall (tombstone) → a later boot never resurrects → explicit
 *    reinstall brings it back and the node_modules artifact was never touched
 *    by governance.
 *  - P4: every service `factory` declared by an admitted artifact's OWN
 *    manifest is iterated (ADJ 建议-3: no more `.find()`-first-only), re-pinned
 *    to a prebuilt-inclusive tree (existsSync lock), truly `import()`ed once,
 *    and shape-probed — verticals: `XVerticalChannel` with canHandle 正负例
 *    (x.com → true; foreign site and empty hints → false, sealing the
 *    always-true-stub escape); omnivision: `createOmnivisionPlugin`
 *    instantiation shape plus tool-registry and validateConfig discriminative
 *    positive/negative pairs (same anti-always-true discipline). It asserts the
 *    import + export contract, not a full governance-boot instantiation.
 */

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import PluginGovernanceGateway, { type PluginGovernanceId } from '../../../host/plugin-governance-host/src/index.ts'

const storageRoots: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of storageRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/** Brand a raw id for gateway calls. */
function gid(value: string): PluginGovernanceId {
  return value as PluginGovernanceId
}

// The repository's frozen factory seed, resolved from this spec's own location
// (…/packages/factory/zdsh-factory-bundle/tests → up four → repo root).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const SEED_PATH = join(REPO_ROOT, 'zdsh-factory', 'seed.json')

/** The three seed columns this matrix walks. Everything else is prose. */
interface SeedRow {
  readonly id: string
  readonly source: string
  readonly enabledAtBoot: boolean
}
const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as { entries: SeedRow[] }

/** Resolve a seed row's `local:` artifact directory, rejecting other states. */
function localSourceDir(row: SeedRow): string {
  if (!row.source.startsWith('local:')) {
    throw new Error(`Gate-P: seed row ${row.id} declares a non-local source (${row.source}); the probe matrix only walks local: artifacts`)
  }
  return resolve(REPO_ROOT, row.source.slice('local:'.length))
}

// The M1 lifecycle pilot stays on verticals; its id, entry and on-disk
// directory are read back from the seed so the test can never drift from the
// shipped manifest.
const PILOT_ID = 'core/webstack-verticals'
const pilotEntry = seed.entries.find(entry => entry.id === PILOT_ID)
if (pilotEntry === undefined) throw new Error(`the repository seed is missing the ${PILOT_ID} pilot entry`)
const PILOT_ABS_SOURCE = localSourceDir(pilotEntry)

/**
 * Per-artifact P4 shape probes, keyed by the seed id they belong to. Each
 * receives the already-imported factory module and asserts the live export
 * shape; every assertion is deterministic and never touches the network (the
 * same bar the verticals canHandle probe set in S1b).
 */
type ShapeProbe = (mod: Record<string, unknown>) => void

const SHAPE_PROBES: Record<string, ShapeProbe> = {
  // The verticals service exit is its `XVerticalChannel` barrel (S1b probe):
  // stable id + deterministic canHandle + run.
  'core/webstack-verticals': (mod) => {
    const VerticalChannelCtor = mod.XVerticalChannel
    expect(
      typeof VerticalChannelCtor,
      'Gate-P P4: factory module import() resolved but exports no XVerticalChannel constructor',
    ).toBe('function')
    const channel = new (VerticalChannelCtor as new () => {
      id: string
      canHandle: (hints: unknown) => boolean
      run: unknown
    })()
    expect(channel.id).toBe('x-vertical')
    expect(typeof channel.run).toBe('function')
    // 正例：x.com 限域须出手，佐证导出的确是活实现。
    expect(channel.canHandle({ hard: [], soft: [], siteFilter: 'x.com' })).toBe(true)
    // 负例（TC-REVIEW-EXEC11 建议-3 / TC-B2-2.1b 卡面「ADJ 建议-3 封恒 true 逃逸」）：
    // 域外站点与空 hints 均必须不出手——恒 true 桩在此红灯。
    expect(channel.canHandle({ hard: [], soft: [], siteFilter: 'example.com' })).toBe(false)
    expect(channel.canHandle({ hard: [], soft: [] })).toBe(false)
  },
  // The omnivision service exit is the plugin assembly barrel published
  // prebuilt by TC-B2-2.1a (`dist/index.js`): factory + class + tool registry
  // + config validator. Construction composes provider objects only — zero
  // network, zero timers — so a disposable instance is probed for real.
  'core/omnivision': (mod) => {
    expect(typeof mod.createOmnivisionPlugin, 'Gate-P P4: omnivision factory exit exports no createOmnivisionPlugin').toBe('function')
    expect(typeof mod.OmniVisionPlugin, 'Gate-P P4: omnivision factory exit exports no OmniVisionPlugin class').toBe('function')
    expect(typeof mod.DEFAULT_CONFIG, 'Gate-P P4: omnivision factory exit exports no DEFAULT_CONFIG').toBe('object')
    const plugin = (mod.createOmnivisionPlugin as (ctx: unknown) => {
      processMessage: unknown
      callTool: unknown
      stats: () => { providers: number }
      dispose: () => void
    })({ config: mod.DEFAULT_CONFIG, workspace: tmpdir() })
    expect(typeof plugin.processMessage, 'Gate-P P4: instantiated plugin lacks processMessage').toBe('function')
    expect(typeof plugin.callTool, 'Gate-P P4: instantiated plugin lacks callTool').toBe('function')
    expect(typeof plugin.stats().providers).toBe('number')
    plugin.dispose()
    // 判别对（同 canHandle 正负例纪律，封「恒有/恒空」两侧逃逸）：真实出厂
    // 工具必须带 handler 在场，捏造名必须缺席——恒定义的桩注册表在此红灯。
    const getTool = mod.getTool as (name: string) => { handler: unknown } | undefined
    expect(getTool('vision_crop')?.handler, 'Gate-P P4: vision_crop registered but carries no handler').toBeTypeOf('function')
    expect(getTool('vision__definitely_not_registered')).toBeUndefined()
    // validateConfig 判别对：出厂默认（负例）不得报 non-local 警告；故意配坏
    // localOllama.baseURL（正例）必须报——恒 [] 与恒 warn 两种桩同时红灯。
    const validateConfig = mod.validateConfig as (config: Record<string, unknown>) => string[]
    const defaults = mod.DEFAULT_CONFIG as Record<string, unknown>
    expect(validateConfig(defaults).some(warning => /non-local/.test(warning))).toBe(false)
    const broken = {
      ...defaults,
      localOllama: { ...(defaults.localOllama as Record<string, unknown>), enabled: true, baseURL: 'https://ollama.example.com/v1' },
    }
    expect(validateConfig(broken).some(warning => /non-local/.test(warning))).toBe(true)
  },
  // The bridge service exit is the cordis assembly barrel published prebuilt by
  // TC-B2-2.2a (`lib/index.js`): name + inject + Config + apply + BridgeRenderer.
  // bridge is NOT a channel artifact — it registers no `canHandle` face (2.2a
  // evidence: zero tools/commands/hooks; apply(ctx) provides the named `bridge`
  // service). So per TC-B2-2.2b 卡面「无 canHandle 面则按其真实导出契约, 禁造」,
  // the probe asserts the REAL cordis-plugin contract + its Standard Schema
  // config validator as the discriminative pair. It never calls apply() (that
  // starts a loopback WS server + heartbeat timers) — the zero-network /
  // zero-timer bar the verticals canHandle and omnivision instantiation probes
  // both hold to stays intact.
  'core/webstack-bridge': (mod) => {
    expect(mod.name, 'Gate-P P4: bridge factory exit exports no plugin name').toBe('bridge')
    expect(typeof mod.apply, 'Gate-P P4: bridge factory exit exports no cordis apply()').toBe('function')
    expect(typeof mod.BridgeRenderer, 'Gate-P P4: bridge factory exit exports no BridgeRenderer class').toBe('function')
    // 负例（真实导出契约）：bridge 不是 channel 型工件，捏造的 canHandle 在此必
    // 缺席——封「照抄 verticals 通道形状」的伪造，兑现卡面「无 canHandle 面」。
    expect(mod.canHandle, 'Gate-P P4: bridge has no canHandle face (it provides a service, not a channel)').toBeUndefined()
    // 无强依赖接缝：inject 是真实空数组（web/logger 均为 optional 探测）。
    expect(Array.isArray(mod.inject), 'Gate-P P4: bridge inject is not an array').toBe(true)
    expect((mod.inject as unknown[]).length, 'Gate-P P4: bridge declares unexpected hard deps').toBe(0)
    // Config 判别对（Standard Schema V1，对应 omnivision validateConfig 的
    // 「恒通过 / 恒拒绝」两侧逃逸封锁）：合法布尔与缺省必须过，非法类型必须拒。
    const config = mod.Config as { '~standard': { version: number; validate: (v: unknown) => { value?: { enabled?: boolean }; issues?: unknown[] } } }
    expect(config['~standard'].version, 'Gate-P P4: bridge Config is not Standard Schema v1').toBe(1)
    const ok = config['~standard'].validate({ enabled: true })
    expect(ok.issues, 'Gate-P P4: bridge Config rejected a valid boolean config').toBeUndefined()
    expect(ok.value?.enabled, 'Gate-P P4: bridge Config dropped a valid enabled=true').toBe(true)
    const bad = config['~standard'].validate({ enabled: 'yes' })
    expect(Array.isArray(bad.issues), 'Gate-P P4: bridge Config accepted a non-boolean enabled (always-valid stub)').toBe(true)
    expect(bad.value, 'Gate-P P4: bridge Config returned a coerced value for invalid input (always-valid stub)').toBeUndefined()
  },
}

// The seed is the single source of truth: a seed row without a P4 probe here is
// a hard error, mechanically enforcing the seed.json discipline「entries 增项
// 须配 Gate-P 探针」(TC-B2-2.1b 卡面双件矩阵的防漂移锁).
for (const row of seed.entries) {
  if (SHAPE_PROBES[row.id] === undefined) {
    throw new Error(`Gate-P: seed row ${row.id} ships without a P4 shape probe (seed.json discipline: "entries 增项须配 Gate-P 探针")`)
  }
}

/** The roster status a seed row's boot posture must land on (K-B2: status column, not just the row). */
function expectedBootStatus(row: SeedRow): 'active' | 'disabled' {
  return row.enabledAtBoot ? 'active' : 'disabled'
}

interface Boot {
  gateway: PluginGovernanceGateway
  storageRoot: string
  resultsPath: string
}

/** Boot a gateway over a fresh temp home pointed at the real repository seed. */
async function boot(storageRoot: string): Promise<Boot> {
  const ctx = new Context()
  contexts.push(ctx)
  const gateway = new PluginGovernanceGateway(ctx, { storageRoot, seedPath: SEED_PATH })
  const self = gateway as unknown as Record<symbol, () => Promise<void>>
  await self[Service.init]!.call(self)
  return { gateway, storageRoot, resultsPath: join(storageRoot, 'data', 'preinstall-results.json') }
}

function pilotSummary(gateway: PluginGovernanceGateway) {
  return gateway.list().plugins.find(plugin => plugin.pluginId === gid(PILOT_ID))
}

describe.each(seed.entries)('Gate-P P1 (matrix) — real seed + real cold-installed artifact: $id', (row) => {
  it('first boot admits it, lands the seed-declared boot posture, and badges factory provenance', async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), 'gate-p-home-'))
    storageRoots.push(storageRoot)
    const { gateway } = await boot(storageRoot)
    await gateway.settlePreinstall()

    // Admitted exactly once, clean install status.
    expect(gateway.preinstallReport().entries[row.id]?.status).toBe('installed')

    // Present in the roster, and — the K-B2 anti-false-green check — actually in
    // the posture the seed row itself declares: verticals DEFAULT DISABLED
    // (enabledAtBoot=false), omnivision boot-ENABLED (enabledAtBoot=true).
    const summary = gateway.list().plugins.find(plugin => plugin.pluginId === gid(row.id))
    expect(summary).toBeDefined()
    expect(summary?.status).toBe(expectedBootStatus(row))
    expect(summary?.source).toBe('native')
    expect(summary?.provenance).toBe('preinstall')
  })
})

describe('Gate-P pilot — restart idempotency over the whole seed', () => {
  it('a restart over the same home re-settles BOTH ledger rows byte-identically', async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), 'gate-p-home-'))
    storageRoots.push(storageRoot)

    const boot1 = await boot(storageRoot)
    await boot1.gateway.settlePreinstall()
    const bytes1 = readFileSync(boot1.resultsPath, 'utf8')

    const boot2 = await boot(storageRoot)
    await boot2.gateway.settlePreinstall()
    // 逐字节：台账整体（含两件行 + ranAt）重启后必须一毫不差。
    expect(readFileSync(boot2.resultsPath, 'utf8')).toBe(bytes1)

    // The ledger really carries exactly the seed's rows, both installed.
    const ledger = JSON.parse(bytes1) as { entries: Record<string, { status: string }> }
    expect(Object.keys(ledger.entries).sort()).toEqual(seed.entries.map(entry => entry.id).sort())
    for (const row of seed.entries) expect(ledger.entries[row.id]?.status).toBe('installed')

    // Roster postures survive the restart for every row (verticals disabled,
    // omnivision active), still badged preinstall.
    for (const row of seed.entries) {
      const summary = boot2.gateway.list().plugins.find(plugin => plugin.pluginId === gid(row.id))
      expect(summary).toBeDefined()
      expect(summary?.status).toBe(expectedBootStatus(row))
      expect(summary?.provenance).toBe('preinstall')
    }
  })
})

describe('Gate-M M1 pilot lifecycle (verticals) — disable → restart → uninstall → no-resurrect → reinstall', () => {
  it('walks the five-step operator lifecycle without ever deleting the node_modules artifact', async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), 'gate-p-home-'))
    storageRoots.push(storageRoot)

    // 1. 停用： the factory preset ships it disabled; the operator's own disable
    //    of the seeded entry is a no-op against that default but must succeed.
    const boot1 = await boot(storageRoot)
    await boot1.gateway.settlePreinstall()
    expect(pilotSummary(boot1.gateway)?.status).toBe('disabled')
    expect((await boot1.gateway.disable({ pluginId: gid(PILOT_ID), reason: 'pilot M1' })).ok).toBe(true)

    // 2. 重启仍停： a fresh gateway over the same home keeps the disabled state
    //    (the factory posture + the persisted decision both say disabled).
    const boot2 = await boot(storageRoot)
    await boot2.gateway.settlePreinstall()
    expect(pilotSummary(boot2.gateway)?.status).toBe('disabled')

    // 3. 卸载： removes it from the roster and writes the tombstone.
    const removed = await boot2.gateway.uninstall({ pluginId: gid(PILOT_ID) })
    expect(removed.ok).toBe(true)
    expect(pilotSummary(boot2.gateway)).toBeUndefined()
    expect(boot2.gateway.preinstallReport().entries[PILOT_ID]?.userUninstalled).toBe(true)
    // 整改④ (EXEC8, TC-B1-CLOSER): DIRECT in-place assertion of the
    // node_modules artifact right after the uninstall — symmetric with the
    // governance-host S3 case — instead of only inferring survival from the
    // step-5 reinstall succeeding.
    expect(existsSync(join(PILOT_ABS_SOURCE, 'package.json'))).toBe(true)

    // 4. 不复活： the next boot's preinstall pass must NOT resurrect it.
    const boot3 = await boot(storageRoot)
    await boot3.gateway.settlePreinstall()
    expect(boot3.gateway.list().plugins.some(p => p.pluginId === gid(PILOT_ID))).toBe(false)
    expect(boot3.gateway.preinstallReport().entries[PILOT_ID]?.userUninstalled).toBe(true)
    // 整改④ again after the no-resurrect boot: what governance refused to
    // delete is still physically on disk at the seed's own source path.
    expect(existsSync(join(PILOT_ABS_SOURCE, 'package.json'))).toBe(true)

    // 5. 重装： the operator can still install it explicitly, which also proves
    //    governance never deleted the node_modules closure (the artifact dir and
    //    its manifest survived every prior step).
    expect(pilotEntry.source.startsWith('local:')).toBe(true)
    const reinstalled = await boot3.gateway.install({ source: PILOT_ABS_SOURCE })
    expect(reinstalled.ok).toBe(true)
    expect(boot3.gateway.list().plugins.some(p => p.pluginId === gid(PILOT_ID))).toBe(true)
  })
})

describe.each(seed.entries)('Gate-P P4 (matrix) — real import() of every service factory: $id', (row) => {
  it('imports each declared factory exit and runs the artifact shape probe', async () => {
    const sourceDir = localSourceDir(row)
    // The exits under probe are the installed artifact's OWN manifest
    // declarations — read the service `factory` paths back from its
    // package.json so this test can never drift from what governance would
    // actually load (mirrors reading the seed above rather than hard-coding a
    // relative path).
    const manifest = JSON.parse(readFileSync(join(sourceDir, 'package.json'), 'utf8')) as {
      dsh?: { capabilities?: Array<{ service?: { factory?: string } }> }
    }
    // 多 factory 遍历（ADJ 建议-3：不再 `.find()` 只取首个）：manifest 声明几
    // 条 service factory，就逐条装载几条。
    const factories = (manifest.dsh?.capabilities ?? [])
      .map(cap => cap.service?.factory)
      .filter((factory): factory is string => typeof factory === 'string' && factory.length > 0)
    if (factories.length === 0) {
      throw new Error(`the installed ${row.id} manifest declares no service factory path`)
    }

    for (const factoryRel of factories) {
      const factoryAbs = resolve(sourceDir, factoryRel)

      // F8/U-1 前置事实：service factory 指向纯库产物，必须先物理落盘。断言文件
      // 存在把「pin 未含 prebuilt」这一回归锁死为红灯（S1b 之 6e31341→43732b7
      // 先例；omnivision 之 9818405 由 TC-B2-2.1a 入库 dist/），而不是让下面的
      // import 抛出难懂的错。
      expect(
        existsSync(factoryAbs),
        `Gate-P P4: ${row.id} service factory '${factoryRel}' is absent under ${sourceDir} — the pinned tree is not prebuilt-inclusive`,
      ).toBe(true)

      // 装载语义实证：真 import() 一次 factory 出口（纯库 re-export barrel），
      // 销 F8/U-1——不是纸面推断，是把 dsh manifest 里那条 factory 路径交给
      // Node ESM 装载器实际跑一遍。
      const mod = (await import(pathToFileURL(factoryAbs).href)) as Record<string, unknown>
      SHAPE_PROBES[row.id]!(mod)
    }
  })
})
