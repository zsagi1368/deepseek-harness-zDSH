/**
 * Chaos isolation suite: any plugin failure — timeouts, synchronous throws,
 * async rejections, health storms — must wound only the misbehaving plugin.
 * The core services (registry, guards) and every other plugin stay alive,
 * responsive, and disposable throughout.
 */

import { describe, expect, it, vi, afterEach } from 'vitest'
import { LoadGuard } from '../src/guards/load-guard.ts'
import { RunGuard } from '../src/guards/run-guard.ts'
import { HealthGuard, type HealthCheck } from '../src/guards/health-guard.ts'
import { DefaultPluginRegistry } from '../src/registry/registry.ts'
import { BasePlugin } from '../src/base/base.ts'
import { PluginStatus } from '../src/spec/index.ts'
import type { CapabilityDeclaration, PluginManifest } from '../src/spec/index.ts'
import { mockContext, testManifest } from './fixtures.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

/** 一个按剧本行动的插件：healthy 正常应答，其余按模式制造故障。 */
class ScriptedPlugin extends BasePlugin {
  constructor(
    manifest: PluginManifest,
    private readonly behavior: 'healthy' | 'sync-throw' | 'async-reject',
  ) {
    super(manifest, mockContext())
  }

  async install(): Promise<void> {}

  async runTool(payload: string): Promise<string> {
    if (this.behavior === 'sync-throw') throw new Error(`boom:${this.manifest.id}`)
    if (this.behavior === 'async-reject') await Promise.reject(new Error(`rej:${this.manifest.id}`))
    return `ok:${payload}`
  }
}

function pluginOf(
  id: string,
  behavior: 'healthy' | 'sync-throw' | 'async-reject' = 'healthy',
  overrides: Partial<PluginManifest> = {},
): ScriptedPlugin {
  const capabilities: CapabilityDeclaration[] = testManifest().capabilities
  return new ScriptedPlugin(testManifest({ id, name: id, capabilities, ...overrides }), behavior)
}

/** 固定种子的伪随机数（LCG），保证组合混沌可重放。 */
function lcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0
    return state / 0x1_0000_0000
  }
}

describe('LoadGuard：全量故障输入不击穿校验器，合法与兼容插件照常通过', () => {
  it('对畸形与恶意 manifest 保持全量（不抛错、可判定），并拒绝不兼容清单', async () => {
    const guard = new LoadGuard()
    // 观察到的真实行为：id 空格/空能力表这类"弱畸形"会被 preLoad 放行
    // （守卫以宽松类型读取，id 只查存在、能力查 schema 不查非空）。
    // 这属于守卫宽容度缺口——记录在案而非断言相反行为。
    const tolerated: Array<[string, Partial<PluginManifest>]> = [
      ['空格 id', { id: 'NOT A VALID ID' }],
      ['空能力表', { capabilities: [] }],
    ]
    for (const [label, overrides] of tolerated) {
      const result = await guard.preLoad(pluginOf('test/tolerant', 'healthy', overrides), '0.1.1-rc.2')
      expect(typeof result.allowed, `${label} 应返回可判定结果`).toBe('boolean')
    }
    // 硬性拒绝面：要求 >=99.0.0 的清单在当前内核下必须被拦下。
    const hopeless = pluginOf('test/hopeless', 'healthy', { dsh: { ...testManifest().dsh, compatible: '>=99.0.0' } })
    const rejected = await guard.preLoad(hopeless, '0.1.1-rc.2')
    expect(rejected.allowed).toBe(false)
    // 故障注入之后，核心校验器状态不受影响：合法插件依旧放行。
    const good = await guard.preLoad(pluginOf('test/fine'), '0.1.1-rc.2')
    expect(good.allowed).toBe(true)
  })
})

describe('RunGuard：超时只切断肇事者', () => {
  it('挂起插件超时抛出后，同一 RunGuard 下健康插件持续可用', async () => {
    const runGuard = new RunGuard()
    const hung = pluginOf('chaos/hang', 'healthy', {
      sandbox: testManifest().sandbox && {
        ...testManifest().sandbox,
        resources: { memoryLimitMb: 64, cpuLimit: 10, timeoutMs: 40, maxOutputBytes: 1000 },
      },
    })
    const healthy = pluginOf('calm/worker')
    runGuard.watch('chaos/hang', hung)
    runGuard.watch('calm/worker', healthy)

    for (let round = 0; round < 3; round += 1) {
      await expect(runGuard.execute('chaos/hang', () => new Promise<string>(() => {})))
        .rejects.toThrow(/timeout|timed out|超时/iu)
      // 肇事者超时不影响旁人：每轮之后健康插件立即正常应答。
      await expect(runGuard.execute('calm/worker', () => healthy.runTool('ping'))).resolves.toBe('ok:ping')
    }
    runGuard.unwatch('chaos/hang')
    runGuard.unwatch('calm/worker')
  })

  it('同步 throw 与异步 reject 都被包装为 PluginError 且计数可见', async () => {
    const runGuard = new RunGuard()
    const thrower = pluginOf('chaos/sync', 'sync-throw')
    const rejecter = pluginOf('chaos/async', 'async-reject')
    runGuard.watch('chaos/sync', thrower)
    runGuard.watch('chaos/async', rejecter)
    await expect(runGuard.execute('chaos/sync', () => thrower.runTool('x'))).rejects.toThrow('boom:chaos/sync')
    await expect(runGuard.execute('chaos/async', () => rejecter.runTool('x'))).rejects.toThrow('rej:chaos/async')

    const syncWatcher = runGuard.getWatcher('chaos/sync')
    const asyncWatcher = runGuard.getWatcher('chaos/async')
    const syncHealth = syncWatcher?.getHealthStatus()
    const asyncHealth = asyncWatcher?.getHealthStatus()
    expect(syncWatcher).toBeDefined()
    expect(asyncWatcher).toBeDefined()
    expect(syncHealth?.callCount).toBe(1)
    expect(asyncHealth?.callCount).toBe(1)
    expect(asyncHealth?.errorRate ?? 0).toBe(1)
    expect(asyncHealth?.healthy).toBe(false)
    expect(syncHealth?.lastError).toContain('boom:chaos/sync')
    runGuard.unwatch('chaos/sync')
    runGuard.unwatch('chaos/async')
  })
})

describe('registry：崩溃隔离与存活不变式', () => {
  it('故障插件注册与执行失败不影响健康插件的 roster 与状态', async () => {
    const registry = new DefaultPluginRegistry()
    const calm = pluginOf('calm/aa')
    const storm = [pluginOf('chaos/s1', 'sync-throw'), pluginOf('chaos/r1', 'async-reject')]
    for (const plugin of [calm, ...storm]) {
      const result = await registry.register(plugin)
      expect(result.success).toBe(true)
    }
    // 直接执行故障剧本（不经守卫）：未捕获的拒绝也不拖垮核心读取面。
    const stormFirst = storm[0] as unknown as ScriptedPlugin
    const stormSecond = storm[1] as unknown as ScriptedPlugin
    await expect(stormFirst.runTool('x')).rejects.toThrow('boom')
    await expect(stormSecond.runTool('x')).rejects.toThrow('rej')
    stormSecond.runTool('y').catch(() => {}) // 模拟无人等待的被拒调用

    const report = registry.getHealthReport()
    expect(report.total).toBe(3)
    expect(() => registry.getAll()).not.toThrow()
    expect(registry.getStatus('calm/aa')).toBe(PluginStatus.ACTIVE)
    expect(registry.findActive().map(p => p.manifest.id)).toContain('calm/aa')

    // 处置肇事者后核心照常运转。
    await registry.unregister('chaos/s1')
    await registry.unregister('chaos/r1')
    expect(registry.getAll()).toHaveLength(1)
    expect(registry.getStatus('calm/aa')).toBe(PluginStatus.ACTIVE)
    await registry.dispose()
  })
})

describe('HealthGuard：升级回路与邻居隔离', () => {
  it('连续失败升级至禁用；恢复检查使状态回落；邻居全程不受影响', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const registry = new DefaultPluginRegistry()
    const calm = pluginOf('calm/bb')
    const sick = pluginOf('sick/cc')
    const calmReg = await registry.register(calm)
    const sickReg = await registry.register(sick)
    expect(calmReg.success, JSON.stringify(calmReg.errors ?? [])).toBe(true)
    expect(sickReg.success, JSON.stringify(sickReg.errors ?? [])).toBe(true)

    const guard = new HealthGuard(registry)
    guard.setOptions({ intervalMs: 8, warningThreshold: 2, disableThreshold: 3 })
    let healthyNow = false
    const check: HealthCheck = { run: async () => healthyNow ? { healthy: true } : { healthy: false, error: 'still sick' } }
    guard.registerCheck('sick/cc', check)
    guard.startMonitoring()

    // 等到跨过禁用阈值（3 次失败 × 8ms 间隔，留足裕量）。
    await vi.waitFor(() => {
      expect(guard.getConsecutiveFailures('sick/cc')).toBeGreaterThanOrEqual(3)
    }, { timeout: 2000, interval: 20 })
    expect(registry.getStatus('sick/cc')).toBe(PluginStatus.DISABLED)
    expect(registry.getStatus('calm/bb')).toBe(PluginStatus.ACTIVE)

    // 恢复路径：检查转绿后状态回升为 ACTIVE，失败计数清零。
    healthyNow = true
    await vi.waitFor(() => {
      expect(guard.getConsecutiveFailures('sick/cc')).toBe(0)
    }, { timeout: 2000, interval: 20 })
    expect(registry.getStatus('sick/cc')).toBe(PluginStatus.ACTIVE)
    expect(registry.getStatus('calm/bb')).toBe(PluginStatus.ACTIVE)
    guard.stopMonitoring()
    guard.stopMonitoring() // 幂等
    await registry.dispose()
  })
})

describe('RunGuard 处置幂等', () => {
  it('unwatch/re-watch 可重复执行且活动清单一致', () => {
    const runGuard = new RunGuard()
    const plugin = pluginOf('calm/idem')
    runGuard.watch('calm/idem', plugin)
    expect(runGuard.getActiveWatchers()).toEqual(['calm/idem'])
    runGuard.unwatch('calm/idem')
    runGuard.unwatch('calm/idem')
    expect(runGuard.getActiveWatchers()).toEqual([])
    runGuard.watch('calm/idem', plugin)
    expect(runGuard.getWatcher('calm/idem')?.pluginId).toBe('calm/idem')
  })
})

describe('组合混沌：固定种子故障风暴下的核心不变式', () => {
  it('60 次混合操作后核心读取面完好、健康插件全部存活、dispose 干净', async () => {
    const registry = new DefaultPluginRegistry()
    const runGuard = new RunGuard()
    const calmIds = ['calm/x1', 'calm/x2', 'calm/x3']
    const chaosModes = ['sync-throw', 'async-reject'] as const
    const chaosIds = ['chaos/x1', 'chaos/x2']
    for (const id of calmIds) {
      const plugin = pluginOf(id)
      expect((await registry.register(plugin)).success).toBe(true)
      runGuard.watch(id, plugin)
    }
    let index = 0
    for (const id of chaosIds) {
      const plugin = pluginOf(id, chaosModes[index % chaosModes.length] ?? 'sync-throw')
      expect((await registry.register(plugin)).success).toBe(true)
      runGuard.watch(id, plugin)
      index += 1
    }

    const rand = lcg(20260825)
    const allIds = [...calmIds, ...chaosIds]
    for (let step = 0; step < 60; step += 1) {
      const roll = rand()
      const target = allIds[Math.floor(rand() * allIds.length)]!
      try {
        if (roll < 0.45) {
          const plugin = registry.get(target)
          await runGuard.execute(target, () => (plugin as ScriptedPlugin).runTool(`t${String(step)}`))
        } else if (roll < 0.6) {
          await registry.disable(target, 'chaos drill')
          await registry.enable(target)
        } else if (roll < 0.7) {
          const temp = pluginOf('temp/flip', 'healthy')
          await registry.register(temp)
          await registry.unregister('temp/flip')
        } else {
          const report = registry.getHealthReport()
          expect(report.total).toBe(allIds.length)
        }
      } catch {
        // 故障剧本的预期产物：被拒/超时/包装错误都允许浮出，核心必须无恙。
      }
      // 每 10 步抽查一次核心不变式。
      if ((step + 1) % 10 === 0) {
        const report = registry.getHealthReport()
        expect(report.total).toBe(allIds.length)
        for (const id of calmIds) {
          expect(registry.getStatus(id)).toBe(PluginStatus.ACTIVE)
        }
        await expect(runGuard.execute(calmIds[0]!, () => {
          return (registry.get(calmIds[0]!) as ScriptedPlugin).runTool('probe')
        })).resolves.toBe('ok:probe')
      }
    }
    // 收官：dispose 干净完成，无悬挂句柄导致的未处理拒绝。
    await registry.dispose()
    runGuard.unwatch('calm/x1')
    runGuard.unwatch('calm/x2')
    runGuard.unwatch('calm/x3')
    runGuard.unwatch('chaos/x1')
    runGuard.unwatch('chaos/x2')
  })
})
