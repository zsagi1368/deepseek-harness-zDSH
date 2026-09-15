/**
 * Gate-P / Gate-M factory pilot — single item (TC-B1-1.3b task 5, 续跑 TC-B1-1.3c).
 *
 * This is the factory's OWN self-managed test surface (DESIGN-intake-tech.md §6
 * Gate-P row: "新 packages/factory（自管面）+ 根 vitest run"). It drives the real
 * governance gateway against the REAL repository seed (`zdsh-factory/seed.json`)
 * and the REAL cold-installed artifact under
 * `packages/factory/zdsh-factory-bundle/node_modules/...`, over a throwaway
 * storage root standing in for a fresh `DSH_HOME`.
 *
 * Note on placement: the root vitest lane glob covers package tests at the path
 * form "packages/<group>/<package>/tests", which has no rule for a two-level
 * "packages/factory/tests", and the design forbids standing up a new lane /
 * editing the shared vitest config — so the pilot lives inside the bundle
 * package ("packages/factory/zdsh-factory-bundle/tests", the same self-managed
 * assembly) and still runs under the existing "pnpm vitest run".
 *
 * What it proves (the batch-1.3 pilot acceptance slice):
 *  - P1 first boot: the seed's single `core/webstack-verticals` row is admitted,
 *    appears in list(), is DEFAULT DISABLED (enabledAtBoot=false, K-B2: assert the
 *    status column not merely the row), badges provenance 'preinstall' + source native.
 *  - P1 idempotency: a restart over the same home re-settles to a byte-identical
 *    result ledger and the same roster.
 *  - M1 lifecycle: disabled → still disabled on restart → uninstall (tombstone) →
 *    a later boot never resurrects → explicit reinstall brings it back and the
 *    node_modules artifact was never touched by governance.
 *  - P4 (TC-B2-S1b): the manifest's service `factory` is re-pinned to a
 *    prebuilt-inclusive tree, so a real `import()` of that exit (the verticals
 *    `lib/index.js` pure-library barrel) must resolve AND hand back the
 *    `XVerticalChannel` shape — this settles the F8/U-1 loading-semantics doubt
 *    (a service factory pointing at a library re-export) with evidence, not
 *    argument. It asserts only the import + export contract, not a full
 *    governance-boot instantiation.
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

// The single pilot artifact id and its on-disk directory, read back from the
// seed itself so the test can never drift from the shipped manifest.
const PILOT_ID = 'core/webstack-verticals'
const seed = JSON.parse(readFileSync(SEED_PATH, 'utf8')) as {
  entries: Array<{ id: string; source: string }>
}
const pilotEntry = seed.entries.find(entry => entry.id === PILOT_ID)
if (pilotEntry === undefined) throw new Error(`the repository seed is missing the ${PILOT_ID} pilot entry`)
const PILOT_ABS_SOURCE = resolve(REPO_ROOT, pilotEntry.source.slice('local:'.length))

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

describe('Gate-P pilot (single item) — real seed + real cold-installed artifact', () => {
  it('first boot admits verticals, keeps it DEFAULT DISABLED, and badges factory provenance', async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), 'gate-p-home-'))
    storageRoots.push(storageRoot)
    const { gateway } = await boot(storageRoot)
    await gateway.settlePreinstall()

    // Admitted exactly once, clean install status.
    expect(gateway.preinstallReport().entries[PILOT_ID]?.status).toBe('installed')

    // Present in the roster, and — the K-B2 anti-false-green check — actually
    // DISABLED (seed enabledAtBoot=false), not merely listed.
    const summary = pilotSummary(gateway)
    expect(summary).toBeDefined()
    expect(summary?.status).toBe('disabled')
    expect(summary?.source).toBe('native')
    expect(summary?.provenance).toBe('preinstall')
  })

  it('a restart over the same home re-settles to a byte-identical ledger', async () => {
    const storageRoot = mkdtempSync(join(tmpdir(), 'gate-p-home-'))
    storageRoots.push(storageRoot)

    const boot1 = await boot(storageRoot)
    await boot1.gateway.settlePreinstall()
    const bytes1 = readFileSync(boot1.resultsPath, 'utf8')

    const boot2 = await boot(storageRoot)
    await boot2.gateway.settlePreinstall()
    expect(readFileSync(boot2.resultsPath, 'utf8')).toBe(bytes1)

    // Roster still holds the disabled preinstall after the restart too.
    const summary = pilotSummary(boot2.gateway)
    expect(summary).toBeDefined()
    expect(summary?.status).toBe('disabled')
    expect(summary?.provenance).toBe('preinstall')
  })
})

describe('Gate-M M1 pilot lifecycle — disable → restart → uninstall → no-resurrect → reinstall', () => {
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

describe('Gate-P P4 — real import() of the factory service exit (F8/U-1 loading-semantics probe)', () => {
  it('dynamically imports the verticals service factory module and asserts the XVerticalChannel shape', async () => {
    // The exit under probe is the installed artifact's OWN manifest declaration —
    // read the service `factory` path back from its package.json so this test can
    // never drift from what governance would actually load (mirrors reading the
    // seed above rather than hard-coding a relative path).
    const manifest = JSON.parse(readFileSync(join(PILOT_ABS_SOURCE, 'package.json'), 'utf8')) as {
      dsh?: { capabilities?: Array<{ service?: { factory?: string } }> }
    }
    const factoryRel = manifest.dsh?.capabilities
      ?.map(cap => cap.service?.factory)
      .find((factory): factory is string => typeof factory === 'string' && factory.length > 0)
    if (factoryRel === undefined) {
      throw new Error('the installed verticals manifest declares no service factory path')
    }
    const factoryAbs = resolve(PILOT_ABS_SOURCE, factoryRel)

    // F8/U-1 前置事实：service factory 指向 lib/ 纯库产物，必须先物理落盘。旧
    // pin（6e31341）树只有 src/ 而无 lib/，装载契约在磁盘层即不成立；re-pin
    // 43732b7（prebuilt-inclusive 树）后 lib/index.js 才存在。断言文件存在把
    // "pin 未含 lib" 这一回归锁死为红灯，而不是让下面的 import 抛出难懂的错。
    expect(
      existsSync(factoryAbs),
      `Gate-P P4: verticals service factory '${factoryRel}' is absent under ${PILOT_ABS_SOURCE} — the pinned tree is not prebuilt-inclusive`,
    ).toBe(true)

    // 装载语义实证：真 import() 一次 factory 出口（纯库 re-export barrel），
    // 销 F8/U-1——不是纸面推断，是把 dsh manifest 里那条 factory 路径交给
    // Node ESM 装载器实际跑一遍。
    const mod = (await import(pathToFileURL(factoryAbs).href)) as Record<string, unknown>
    const VerticalChannelCtor = mod.XVerticalChannel
    expect(
      typeof VerticalChannelCtor,
      'Gate-P P4: factory module import() resolved but exports no XVerticalChannel constructor',
    ).toBe('function')

    // 形状断言：new 出 VerticalChannel 契约（稳定 id + 确定性 canHandle + run），
    // 与 framework.ts 的 VerticalChannel 接口逐面对齐（本地结构镜像，零跨包依赖）。
    const channel = new (VerticalChannelCtor as new () => {
      id: string
      canHandle: unknown
      run: unknown
    })()
    expect(channel.id).toBe('x-vertical')
    expect(typeof channel.canHandle).toBe('function')
    expect(typeof channel.run).toBe('function')
    // 确定性判定（纯函数、不触网）：x.com 限域须出手，佐证导出的确是活实现。
    expect(
      (channel.canHandle as (hints: unknown) => boolean)({ hard: [], soft: [], siteFilter: 'x.com' }),
    ).toBe(true)
  })
})
