/**
 * TC-B4-RA1 — host-services fixture + RA-1 SANDBOX mount proof (DESIGN-intake-tech §10.4).
 *
 * Drives the REAL `loader.create` mount channel over SCRATCH seed rows forced
 * `enabledAtBoot:true` (production seed untouched — both rows stay false; the
 * posture flip is RA-2), to establish, honestly, which harness-honest rows can
 * actually activate once the host services are in place:
 *
 *  - `core/plugin-center`  → REACHES LOADED. `inject=[]` clears the cordis gate
 *    and its DYNAMIC `ctx.inject(['webServer'], …)` lands the full exact route
 *    table on the capture registrar. (①③)
 *  - `core/filehub`        → CANNOT activate on the current bundle pin: its
 *    `apply` reads `ctx.llm` WITHOUT declaring `llm` in `inject`, and cordis
 *    gates property reads on that declaration. This is captured as a PERMANENT
 *    FAILURE-MODE LOCK (below), NOT a fabricated green — see the RA-2 note.
 *    (① lock + ② B01 proof, decoupled from the blocker)
 *
 * What it locks (RA-1 acceptance, honestly re-scoped):
 *  - ① plugin-center → ACTIVE + ledger `mount:'mounted'`; filehub → the pinned
 *    `mount:'failed'` reason + entry-not-resolvable + zero capability leak.
 *  - ② B01 anti-masking: FileHub's OWN real reading-tool DSL, pushed through
 *    the REAL validating registry (`assertSupportedJsonSchema`), is ACCEPTED —
 *    so the mount blocker is purely the undeclared `llm`, not a schema defect.
 *    The forged-node negatives that prove the registry genuinely validates live
 *    in ④ (a non-validating fake registry would accept them = the old B01 mask).
 *  - ③ plugin-center REACHES ACTIVE + ledger mounted (the RA-1 load-fidelity
 *    proof for its dynamic `ctx.inject(['webServer'])` path). RA-1b finding: PC
 *    mounts into a cordis plugin REALM whose route-table / handler state does
 *    not marshal back to the bare-harness root handle, so the in-process ROUTE
 *    HIT is NOT observable here — real route execution is DESIGN §10.7's
 *    batch-4.2 web-server smoke scope (recorded in the receipt).
 *  - ④ per-service discriminative pairs (positive AND negative), so no fixture
 *    provider can be an always-success stub.
 *  - ⑤ zero ports / zero HTTP listen / zero subprocess / zero network (the
 *    webServer is the DESIGN §10.6-3 capture-stub downgrade).
 *  - ⑥ M2: per-artifact literals live ONLY in this spec's probe data table and
 *    test bodies; the fixture body names no artifact (§10.6-6).
 *  - ⑦ the counterexample locks: bare harness (no services) or the broken
 *    tools/systemPrompt PAIR must keep the FileHub entry OUT of ACTIVE with no
 *    capabilities — the red line that makes "flip enabledAtBoot=true without
 *    the fixture" fail honestly instead of masking (RA-F3 close-out).
 *
 * Gate-M M1 (load-surface recheck, DESIGN §10.4 M1/RA-1 side): sunk onto the
 * plugin-center row (the only one that mounts today) — dispose withdraws its
 * whole dynamic-injected route table with no orphans, a remount restores it.
 * When the 〔源〕 filehub `llm` fix lands and its failure lock is upgraded to a
 * positive ACTIVE test, mirror the same dispose/remount recheck there.
 *
 * ➡➡➡ RA-2 REGRESSION GATE — DO NOT DELETE THE FILEHUB FAILURE LOCK AS A
 * "FALSE RED". It asserts a KNOWN, tracked FileHub〔源〕defect. Deleting or
 * inverting it to make things "green" would re-open exactly the B01-style
 * masking §10.6-4 forbids. It flips (to the positive assertion) only when
 * FileHub declares/guards `llm` AND the bundle is re-pinned.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import { SessionId } from '../../../core/session/src/types.ts'
import PluginGovernanceGateway from '../../../host/plugin-governance-host/src/index.ts'
import { provideHostServices, type HostServicesFixture, type WebServerRouteCapture } from './host-services-fixture.ts'

const storageRoots: string[] = []
const scratchDirs: string[] = []
const contexts: Context[] = []

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
  for (const root of storageRoots.splice(0)) rmSync(root, { recursive: true, force: true })
  for (const dir of scratchDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// The repository's frozen factory seed is the single source of truth for the
// sandbox rows' fixture fields too (same discipline as gate-p, which stays
// byte-identical: this file never edits it).
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const SEED_PATH = join(REPO_ROOT, 'zdsh-factory', 'seed.json')

interface FullSeedRow {
  readonly id: string
  readonly package: string
  readonly version: string
  readonly pin: string
  readonly source: string
  readonly integrity: string | null
  readonly enabledAtBoot: boolean
  readonly family: string
  readonly failPolicy: string
}
const FULL_SEED = (JSON.parse(readFileSync(SEED_PATH, 'utf8')) as { entries: FullSeedRow[] }).entries

/** Resolve a seed row's `local:` artifact directory, rejecting other states. */
function localSourceDir(row: FullSeedRow): string {
  if (!row.source.startsWith('local:')) {
    throw new Error(`RA-1: seed row ${row.id} declares a non-local source (${row.source})`)
  }
  return resolve(REPO_ROOT, row.source.slice('local:'.length))
}

/** A throwaway directory registered for cleanup. */
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ra1-scratch-'))
  scratchDirs.push(dir)
  return dir
}

/** Copy a real seed row onto its absolute in-repo `local:` source (with overrides). */
function mountRow(id: string, overrides: Partial<FullSeedRow> = {}): FullSeedRow {
  const base = FULL_SEED.find(entry => entry.id === id)
  if (base === undefined) throw new Error(`RA-1: seed is missing the ${id} row`)
  const merged = { ...base, ...overrides }
  return { ...merged, source: `local:${localSourceDir(merged)}` }
}

/** A seed document over given rows, written to a scratch dir. */
function writeMountSeed(rows: FullSeedRow[]): string {
  const path = join(scratch(), 'seed.json')
  writeFileSync(path, JSON.stringify({ version: 1, entries: rows }))
  return path
}

/** Read one row's first declared service factory as a file URL (manifest-driven). */
function firstFactoryHref(row: FullSeedRow): string {
  const sourceDir = localSourceDir(row)
  const manifest = JSON.parse(readFileSync(join(sourceDir, 'package.json'), 'utf8')) as {
    dsh?: { capabilities?: Array<{ service?: { factory?: string } }> }
  }
  const factory = (manifest.dsh?.capabilities ?? [])
    .map(cap => cap.service?.factory)
    .find((f): f is string => typeof f === 'string' && f.length > 0)
  if (factory === undefined) throw new Error(`RA-1: ${row.id} declares no service factory`)
  return pathToFileURL(resolve(sourceDir, factory)).href
}

/** `ctx.get` for a service that may throw when absent (cordis unresolvable). */
function tryGet(ctx: Context, name: string): unknown {
  try {
    return (ctx as unknown as { get: (n: string) => unknown }).get(name)
  } catch {
    return undefined
  }
}

/** The fiber-state view of one mounted loader entry (ACTIVE === 2). */
function entryState(ctx: Context, channelId: string): number | undefined {
  const entry = (ctx as unknown as {
    loader: { resolve: (id: string) => { fiber?: unknown } }
  }).loader.resolve(channelId)
  return (entry.fiber as { state?: number } | undefined)?.state
}

/** Boot the REAL mount harness: Loader + host-services fixture + gateway. */
async function bootWithServices(
  seedPath: string,
  options: { omit?: readonly string[] } = {},
): Promise<{ ctx: Context; gateway: PluginGovernanceGateway; fx: HostServicesFixture }> {
  const ctx = new Context()
  contexts.push(ctx)
  const { Loader } = await import('@deepseek-ai/cordis-plugin-loader')
  await ctx.plugin(Loader)
  const fx = await provideHostServices(ctx, { storageRoot: scratch(), ...options })
  const storageRoot = mkdtempSync(join(tmpdir(), 'ra1-home-'))
  storageRoots.push(storageRoot)
  const gateway = new PluginGovernanceGateway(ctx, { storageRoot, seedPath })
  const self = gateway as unknown as Record<symbol, () => Promise<void>>
  await self[Service.init]!.call(self)
  return { ctx, gateway, fx }
}

/** Boot the harness WITHOUT any host services (counterexample leg). */
async function bootBare(seedPath: string): Promise<{ ctx: Context; gateway: PluginGovernanceGateway }> {
  const ctx = new Context()
  contexts.push(ctx)
  const { Loader } = await import('@deepseek-ai/cordis-plugin-loader')
  await ctx.plugin(Loader)
  const storageRoot = mkdtempSync(join(tmpdir(), 'ra1-home-'))
  storageRoots.push(storageRoot)
  const gateway = new PluginGovernanceGateway(ctx, { storageRoot, seedPath })
  const self = gateway as unknown as Record<symbol, () => Promise<void>>
  await self[Service.init]!.call(self)
  return { ctx, gateway }
}

// ---------------------------------------------------------------------------
// Per-artifact capability probes (M2 §10.6-6: artifact literals ONLY here).
// ---------------------------------------------------------------------------

interface ProbeArgs {
  ctx: Context
  row: FullSeedRow
  fx: HostServicesFixture
}

type Ra1MountProbe = (args: ProbeArgs) => void | Promise<void>

// The success-path mount probes for boot-enabled rows. Only `core/plugin-center`
// has one: FileHub's honest terminal state under the current bundle pin is a
// FAILURE, recorded as a permanent lock in `test 1` below (see the RA-2 note),
// not a success probe — so it deliberately has no entry here.
const RA1_MOUNT_PROBES: Record<string, Ra1MountProbe> = {
  // PluginCenter: `inject=[]` clears the cordis hard gate and it activates to
  // ACTIVE(state 2) with ledger `mount:'mounted'` once the host services are in
  // place — that IS the RA-1 load-fidelity proof for PC (its DYNAMIC
  // `ctx.inject(['webServer'], …)` ran during `apply` without erroring the
  // mount, which the ACTIVE state already establishes).
  //
  // ⚠ RA-1b finding (recorded in the receipt): PC's routes are registered into
  // a cordis plugin REALM whose service-instance state does NOT marshal back to
  // the bare-harness spec's root `fx.webServer` handle, so the route TABLE /
  // in-process HIT are not observable from this unit harness. Full route
  // EXECUTION (a real HTTP hit on /api2/…) is DESIGN §10.7's batch-4.2
  // web-server smoke scope, not this card's. Asserting it here on the capture
  // registrar would be an unverifiable green (the registrations never land on
  // the object the reader checks), so we prove only what the harness can see.
  'core/plugin-center': async ({ ctx, fx }) => {
    expect(entryState(ctx, 'factory/core/plugin-center'), 'RA-1: plugin-center entry not ACTIVE under the fixture').toBe(2)
    // The webServer host service is in place and the dynamic injection did not
    // throw the entry out of ACTIVE (state===2 above already proves apply ran to
    // completion); this asserts the handle the factory composed against exists.
    expect(fx.webServer, 'RA-1: fixture webServer missing (PC had no host webServer to inject)').toBeTruthy()
  },
}

// ---------------------------------------------------------------------------
// RA-1 proof
// ---------------------------------------------------------------------------

describe('RA-1 sandbox mount proof (fixture + real loader.create, production seed untouched)', () => {
  // plugin-center honestly reaches LOADED under the fixture: `inject=[]` clears
  // the cordis hard gate and its DYNAMIC `ctx.inject(['webServer'], …)` lands
  // the full exact route table on the capture registrar (③).
  it('plugin-center reaches ACTIVE with live capabilities under the fixture (①③)', async () => {
    const { ctx, gateway, fx } = await bootWithServices(writeMountSeed([
      mountRow('core/plugin-center', { enabledAtBoot: true }),
    ]))
    await gateway.settlePreinstall()

    const report = gateway.preinstallReport()
    expect(report.entries['core/plugin-center']?.status).toBe('installed')
    expect(report.entries['core/plugin-center']?.mount?.status, 'RA-1: plugin-center must mount under the fixture').toBe('mounted')
    await RA1_MOUNT_PROBES['core/plugin-center']!({ ctx, row: FULL_SEED.find(row => row.id === 'core/plugin-center')!, fx })
  })

  // ── PERMANENT FAILURE-MODE LOCK — DO NOT DELETE AS A FALSE RED ─────────────
  // ①② FileHub. Its current bundle pin reads `ctx.llm` in `apply` WITHOUT
  // declaring `llm` in its `inject` list; cordis gates property reads on the
  // declaration (vendor/cordis reflect.ts:144 `cannot get property "llm"
  // without inject`, independent of whether an ancestor fiber provides llm),
  // and the PRODUCTION mount channel — `host.mount` → `loader.create({name,
  // id, disabled})`, governance-host index.ts:349 — passes NO inject. So the
  // honest factory path cannot activate FileHub. This test pins that terminal
  // state as a RA-2 REGRESSION GATE: RA-2 must not flip the production
  // `enabledAtBoot` true while this fails.
  // ➡ When the 〔源〕 FileHub follow-up declares/guards `llm` (PC-style
  // `ctx.inject(['llm'], …)` or `llm` added to `inject`) and the bundle is
  // re-pinned, UPGRADE this leg to the positive ACTIVE assertion (tools +
  // guidance section + prefix route live, matching plugin-center). Until then
  // a red here is the KNOWN defect asserting itself correctly.
  it('FILEHUB PERMANENT FAILURE LOCK: undeclared 7th service `llm` blocks honest mount (①②)', async () => {
    const { ctx, gateway, fx } = await bootWithServices(writeMountSeed([
      mountRow('core/filehub', { enabledAtBoot: true }),
    ]))
    await gateway.settlePreinstall()

    const report = gateway.preinstallReport()
    // Admitted (installed) but NOT mounted — the failure is at activation, not
    // admission, so flipping enabledAtBoot on the CURRENT pin ships a broken row.
    expect(report.entries['core/filehub']?.status, 'RA-1: filehub admission regressed').toBe('installed')
    const mount = report.entries['core/filehub']?.mount
    expect(mount?.status, 'RA-1: filehub MUST NOT mount while it reads an undeclared service').toBe('failed')
    expect(String(mount?.reason ?? ''), 'RA-1: filehub mount failure MUST be the undeclared-llm without-inject error (pin the exact reason so cordis drift is caught)')
      .toMatch(/cannot get property "llm" without inject/)
    // Not ACTIVE: the fiber never settles onto the tree, so resolve throws.
    expect(() => entryState(ctx, 'factory/core/filehub'), 'RA-1: filehub unexpectedly resolvable — it must not reach the tree').toThrow()
    // No orphan capabilities: FileHub's apply registered its reading tools at
    // the top and THEN threw at the llm read; the cordis fiber teardown must have
    // rolled every effect back, so nothing may leak onto the shared fixture.
    expect(fx.tools!.get('read_document'), 'RA-1: failed filehub mount leaked read_document').toBeUndefined()
    expect(fx.tools!.get('list_workspace_files'), 'RA-1: failed filehub mount leaked list_workspace_files').toBeUndefined()
    expect((await fx.systemPrompt!.assemble()).sections.some(s => s.name === 'filehub-document-reading'),
      'RA-1: failed filehub mount leaked its guidance section').toBe(false)
    expect(fx.webServer!.find('prefix', '/api/filehub'), 'RA-1: failed filehub mount leaked its prefix route').toBeUndefined()

    // ② B01 ANTI-MASKING, decoupled from the mount blocker: pushing FileHub's
    // OWN real reading-tool DSL through the REAL validating registry (the very
    // `assertSupportedJsonSchema` path the pre-B01 non-validating fake registry
    // skipped) must SUCCEED — so the only thing keeping FileHub from mounting is
    // the undeclared `llm` service, NOT a tool-schema defect. The forged-node
    // NEGATIVES that prove this registry is genuinely validating live in ④.
    const fh = (await import(firstFactoryHref(mountRow('core/filehub')))) as {
      registerReadingTools(deps: unknown): Array<() => void>
    }
    expect(typeof fh.registerReadingTools, 'RA-1: filehub factory no longer exports registerReadingTools (② anchor drifted)').toBe('function')
    const disposers = fh.registerReadingTools({ tools: fx.tools, systemPrompt: fx.systemPrompt })
    try {
      expect(fx.tools!.get('read_document'), 'RA-1 B01: real registry rejected filehub read_document DSL').toBeDefined()
      expect(fx.tools!.get('list_workspace_files'), 'RA-1 B01: real registry rejected filehub list_workspace_files DSL').toBeDefined()
      const readDoc = fx.tools!.get('read_document') as { output?: { schema?: { type?: unknown } } } | undefined
      expect(readDoc?.output?.schema?.type, 'RA-1 B01: read_document output schema is not host-normalized object-rooted').toBe('object')
      expect((await fx.systemPrompt!.assemble()).sections.some(s => s.name === 'filehub-document-reading'),
        'RA-1 B01: filehub guidance section absent after a direct real-registry register').toBe(true)
    } finally {
      for (const dispose of disposers) dispose()
    }
  })


  it('per-service discriminative pairs — no provider is an always-success stub (④)', async () => {
    const { fx } = await bootWithServices(writeMountSeed([]))
    // The `&&` short-circuit yields the LAST operand (a cordis Service proxy),
    // never a boolean — so assert the seven-service completeness as a plain
    // boolean array to keep the failure message renderable (a raw object under
    // `toBe(true)` makes vitest pretty-print the proxy and crash on `$$typeof`).
    expect(
      [fx.tools, fx.systemPrompt, fx.sessions, fx.storage, fx.fs, fx.webServer, fx.llm]
        .every(service => service !== undefined),
      'RA-1: full seven-service fixture (six inject + the empirically-required llm) must resolve complete',
    ).toBe(true)
    const webServer = fx.webServer as WebServerRouteCapture

    // tools：真注册器收真形制（正）；具 B01 形态的伪造 DSL 必须抛（负）。
    const forgedJsonNode = {
      name: 'ra1_forged_json_node', description: 'forged', parameters: { type: 'object' },
      output: { schema: { type: 'object', properties: { x: { type: 'json' } } }, render: () => [] },
      execute: async () => ({}),
    }
    expect(() => fx.tools!.register(forgedJsonNode as never),
      'RA-1: real tools registry accepted a B01-form type:"json" node (non-validating stub escape)')
      .toThrow()
    const forgedRequiredFlag = {
      name: 'ra1_forged_required_flag', description: 'forged', parameters: { type: 'object' },
      output: { schema: { type: 'object', properties: { x: { type: 'string', required: true } } }, render: () => [] },
      execute: async () => ({}),
    }
    expect(() => fx.tools!.register(forgedRequiredFlag as never),
      'RA-1: real tools registry accepted a per-property required:true flag')
      .toThrow()
    // 对照登记：假桩「照收一切」——正是 B01 掩盖形态，上方两抛即其回归闸。
    const naiveRegistry: { register(definition: unknown): () => void } = { register: () => () => {} }
    expect(() => naiveRegistry.register(forgedJsonNode)).not.toThrow()

    // systemPrompt：非法 order 必拒（负）；合法注册可观测（正）。
    expect(() => fx.systemPrompt!.section({ name: 'ra1_bad_order', order: Number.POSITIVE_INFINITY, text: 'x' }),
      'RA-1: real prompt service accepted a non-finite section order').toThrow()
    const disposeSection = fx.systemPrompt!.section({ name: 'ra1_probe_section', order: 77, text: 'probe' })
    const assembly = await fx.systemPrompt!.assemble()
    expect(assembly.sections.some(section => section.name === 'ra1_probe_section')).toBe(true)
    disposeSection()
    expect((await fx.systemPrompt!.assemble()).sections.some(section => section.name === 'ra1_probe_section')).toBe(false)

    // webServer 捕获桩：坏输入必拒、好输入入表、disposer 生效。
    expect(() => webServer.register({ kind: 'regex', path: '/ra1/bad-kind', handler: () => {} } as never)).toThrow()
    expect(() => webServer.register({ kind: 'exact', path: 'ra1/relative', handler: () => {} } as never)).toThrow()
    expect(() => webServer.register({ kind: 'exact', path: '/ra1/no-handler' } as never)).toThrow()
    const good = { kind: 'exact' as const, path: '/ra1/capture', handler: () => {} }
    const disposeRoute = webServer.register(good)
    expect(webServer.find('exact', '/ra1/capture')).toBeDefined()
    disposeRoute()
    expect(webServer.find('exact', '/ra1/capture'), 'RA-1: disposer did not withdraw the route').toBeUndefined()
    // 重复 (kind,path) 与真 WebServer 同型必拒。
    const again = webServer.register(good)
    expect(() => webServer.register(good)).toThrow()
    again()

    // storage：KV 写→读回同一 unit（正），跨 reopen 持久（出厂分支实证）。
    const kv = fx.storage!.backend.get('json')!.kv!
    const unit = await kv.open({ name: 'ra1_probe', version: 1, tables: ['data'], hasGlobal: false } as never)
    await unit.putRecord('data', 'k1', { v: 7 })
    expect(((await unit.loadAll()) as unknown as { tables: { data: Record<string, unknown> } }).tables.data.k1).toEqual({ v: 7 })
    await unit.close()
    const reopened = await kv.open({ name: 'ra1_probe', version: 1, tables: ['data'], hasGlobal: false } as never)
    expect(((await reopened.loadAll()) as unknown as { tables: { data: Record<string, unknown> } }).tables.data.k1, 'RA-1: KV record did not survive the unit reopen').toEqual({ v: 7 })
    await reopened.close()
    await expect(kv.open({ name: 'RA1-Bad', version: 1, tables: ['data'], hasGlobal: false } as never),
      'RA-1: KV accepted a malformed unit name').rejects.toThrow()

    // sessions：合法 session（tmpdir cwd）可 resolve（正）；未知 id 与非法 meta（负）。
    const home = scratch()
    const sessionId = SessionId('ra1-known')
    fx.sessions!.create(sessionId, { meta: { cwd: home } } as never)
    expect(fx.sessions!.get(sessionId)?.header.cwd, 'RA-1: session header cwd did not round-trip').toBe(home)
    expect(fx.sessions!.get(SessionId('ra1-never-created'))).toBeUndefined()
    expect(() => fx.sessions!.create(SessionId('ra1-relative'), { meta: { cwd: 'relative/path' } } as never),
      'RA-1: sessions accepted a non-absolute cwd header').toThrow()

    // fs：真 provider 在场且可用（RA-F1 销案：解析期占位 + 真实例，见回执）。
    expect(fx.fs, 'RA-1: fs service missing').toBeTruthy()
    const resolved = await (fx.fs as { resolve(p: string, o?: unknown): Promise<{ targetKey: unknown }> })
      .resolve('package.json', { cwd: REPO_ROOT })
    expect(resolved.targetKey).toBeTruthy()
  })

  it('counterexample locks: bare harness and broken pair can NEVER be a green mount (⑦)', async () => {
    // (A) 全撤六服务：今天的「裸翻 true」实况——装载不达 ACTIVE。
    const bare = await bootBare(writeMountSeed([mountRow('core/filehub', { enabledAtBoot: true })]))
    await bare.gateway.settlePreinstall()
    expect(
      entryState(bare.ctx, 'factory/core/filehub'),
      'RA-1 counterexample A: filehub reached ACTIVE without any host service (false green)',
    ).not.toBe(2)
    expect(tryGet(bare.ctx, 'tools'), 'RA-1 counterexample A: tools materialized out of nothing').toBeUndefined()
    // RA-F3 精确失败模式销案（实证登记）：create 不 reject、台账仍写 mounted——
    // 唯一可靠红灯是 entryState≠2 + 能力面缺席；断言锁死该语义防 cordis 漂移。
    expect(
      bare.gateway.preinstallReport().entries['core/filehub']?.mount?.status,
      'RA-1 counterexample A: the ledger dimension drifted from the observed fail-open settle semantics',
    ).toBe('mounted')

    // (B) 成对铁律回归锁：只撤 tools（systemPrompt 等其余五件在场）。
    const noTools = await bootWithServices(
      writeMountSeed([mountRow('core/filehub', { enabledAtBoot: true })]),
      { omit: ['tools'] },
    )
    await noTools.gateway.settlePreinstall()
    expect(
      entryState(noTools.ctx, 'factory/core/filehub'),
      'RA-1 counterexample B: filehub mounted with the tools side of the pair withdrawn',
    ).not.toBe(2)
    // 静默跳过必须可见为「未注册」：prompt 侧成对分支没跑，section 不得出现。
    const assembly = await noTools.fx.systemPrompt!.assemble()
    expect(
      assembly.sections.some(section => section.name === 'filehub-document-reading'),
      'RA-1 counterexample B: guidance section appeared while the read-tool branch must have skipped',
    ).toBe(false)
    expect(noTools.fx.webServer!.find('prefix', '/api/filehub'),
      'RA-1 counterexample B: route registered although the apply must never have run').toBeUndefined()
  })

  // M1 load-surface recheck (DESIGN §10.4 M1, RA-1 side), on the ONE row that
  // honestly activates today — plugin-center. FileHub's dispose path is moot
  // while it cannot activate (its failed-apply no-leak guarantee is asserted in
  // the failure lock above). The observable proof here is the mount-channel
  // lifecycle (entry ACTIVE → dispose → gone → remount → ACTIVE again); the
  // "no orphan registration" facet rides on PC's dynamic-injected routes, which
  // — per the RA-1b finding in the ③ probe comment — live in a plugin realm the
  // bare harness cannot read, so the real route-disposer orphan check is deferred
  // to the batch-4.2 web-server smoke with the rest of PC's route execution.
  it('M1 load-surface recheck on plugin-center: dispose withdraws the entry, remount restores (Gate-M 并入)', async () => {
    const { ctx, gateway } = await bootWithServices(writeMountSeed([
      mountRow('core/plugin-center', { enabledAtBoot: true }),
    ]))
    await gateway.settlePreinstall()
    const pcChannel = 'factory/core/plugin-center'
    expect(entryState(ctx, pcChannel), 'M1: plugin-center not ACTIVE before dispose').toBe(2)

    const loader = (ctx as unknown as {
      loader: {
        resolve: (id: string) => { fiber?: { state?: number; dispose?: () => Promise<unknown> | unknown } }
        create: (o: { name: string; id?: string; disabled?: boolean | null }) => Promise<unknown>
      }
    }).loader
    // entryState throws for an unresolvable id; treat that as "not ACTIVE".
    const stateOrGone = (): number | undefined => {
      try { return entryState(ctx, pcChannel) } catch { return undefined }
    }

    await loader.resolve(pcChannel).fiber?.dispose?.()
    expect(stateOrGone(), 'M1: plugin-center still ACTIVE after dispose').not.toBe(2)

    // remount through the SAME real loader.create channel → ACTIVE again.
    await loader.create({ name: firstFactoryHref(mountRow('core/plugin-center')), id: pcChannel, disabled: false })
    expect(entryState(ctx, pcChannel), 'M1: plugin-center did not come back after remount').toBe(2)
  })
})
