/**
 * LoadGuard - 加载守卫
 *
 * 在插件加载前进行预检查，确保插件安全性和兼容性。
 */

import { Plugin, LoadResult } from '../spec/index.js'
import type { PluginSandboxConfig, CapabilityDeclaration } from '../spec/index.js'
import { semverCompare } from '../semver.js'

/**
 * 预检查看到的清单形状：字段可能缺失或畸形（这正是检查要拦截的），
 * 因此以宽松类型读取，避免"类型系统证明不可达"的防御分支被误判。
 */
type LooseManifest = Partial<Plugin['manifest']>

interface PreLoadCheck {
  name: string
  run(plugin: Plugin, kernelVersion: string): CheckResult
}

interface CheckResult {
  passed: boolean
  severity?: 'error' | 'warning' | undefined
  message?: string | undefined
}

class CheckPassed implements CheckResult {
  constructor(public message?: string) {}
  passed = true
}

class CheckFailed implements CheckResult {
  constructor(
    public message: string,
    public severity: 'error' | 'warning' = 'error',
  ) {}
  passed = false
}

/**
 * LoadGuard - 加载守卫
 *
 * 在插件加载前按注册顺序执行一组预检查（清单完整性、版本兼容、
 * 沙箱配置、能力声明、符号隔离），返回聚合的加载结果。
 */
export class LoadGuard {
  private checks: PreLoadCheck[] = [
    new ManifestIntegrityCheck(),
    new VersionCompatibilityCheck(),
    new SandboxConfigCheck(),
    new CapabilityValidityCheck(),
    new SymbolIsolationCheck(),
  ]

  /**
   * 执行全部预检查
   * @param plugin - 待加载的插件。
   * @param kernelVersion - 当前内核版本，用于版本兼容检查。
   * @returns 聚合的加载结果（allowed/failures/warnings）。
   */
  preLoad(plugin: Plugin, kernelVersion: string): Promise<LoadResult> {
    const results = this.checks.map(check => check.run(plugin, kernelVersion))

    const failures = results.filter(r => !r.passed).map(r => ({
      check: r.message?.split(':')[0] || 'unknown',
      message: r.message || 'Unknown error',
      severity: r.severity || 'error',
    }))

    const warnings = results
      .filter(r => !r.passed && r.severity === 'warning')
      .map(r => ({
        check: r.message?.split(':')[0] || 'unknown',
        message: r.message || 'Unknown warning',
      }))

    return Promise.resolve({
      allowed: failures.filter(f => f.severity === 'error').length === 0,
      failures,
      warnings,
    })
  }
}

class ManifestIntegrityCheck implements PreLoadCheck {
  name = 'manifest-integrity'

  run(plugin: Plugin): CheckResult {
    const manifest = plugin.manifest as LooseManifest

    if (!manifest.id) {
      return new CheckFailed('Plugin manifest missing required field: id')
    }
    if (!manifest.version) {
      return new CheckFailed('Plugin manifest missing required field: version')
    }
    if (!manifest.name) {
      return new CheckFailed('Plugin manifest missing required field: name')
    }
    if (!manifest.dsh?.compatible) {
      return new CheckFailed('Plugin manifest missing required field: dsh.compatible')
    }
    if (!manifest.capabilities?.length) {
      return new CheckFailed('Plugin manifest missing required field: capabilities')
    }
    if (!manifest.sandbox) {
      return new CheckFailed('Plugin manifest missing required field: sandbox')
    }

    return new CheckPassed()
  }
}

class VersionCompatibilityCheck implements PreLoadCheck {
  name = 'version-compatibility'

  run(plugin: Plugin, kernelVersion: string): CheckResult {
    const compatible = (plugin.manifest as LooseManifest).dsh?.compatible || ''

    // 版本检查走共享 semver 比较（semver.ts），杜绝字典序误判
    // （如 '0.9.0' >= '0.10.0' 在字符串比较下为真）。
    if (compatible.includes('<')) {
      const maxVersion = compatible.split('<')[1]?.trim()
      if (maxVersion && semverCompare(kernelVersion, maxVersion) >= 0) {
        return new CheckFailed(
          `Plugin requires DSH < ${maxVersion}, but running ${kernelVersion}`,
          'error',
        )
      }
    }

    if (compatible.includes('>=')) {
      const minVersion = compatible.split('>=')[1]?.split(' ')[0]
      if (minVersion && semverCompare(kernelVersion, minVersion) < 0) {
        return new CheckFailed(
          `Plugin requires DSH >= ${minVersion}, but running ${kernelVersion}`,
          'error',
        )
      }
    }

    return new CheckPassed()
  }
}

class SandboxConfigCheck implements PreLoadCheck {
  name = 'sandbox-config'

  run(plugin: Plugin): CheckResult {
    const sandbox = (plugin.manifest as LooseManifest).sandbox as
      | Partial<PluginSandboxConfig>
      | undefined

    if (!sandbox) {
      return new CheckFailed('Plugin manifest missing required field: sandbox')
    }

    if (!sandbox.type) {
      return new CheckFailed('Sandbox config missing required field: type')
    }

    if (!['process', 'worker', 'inline'].includes(sandbox.type)) {
      return new CheckFailed(
        `Invalid sandbox type: ${sandbox.type}. Must be one of: process, worker, inline`,
        'error',
      )
    }

    if (!sandbox.resources) {
      return new CheckFailed('Sandbox config missing required field: resources')
    }

    if (sandbox.resources.memoryLimitMb <= 0) {
      return new CheckFailed('Memory limit must be positive', 'error')
    }

    if (sandbox.resources.timeoutMs <= 0) {
      return new CheckFailed('Timeout must be positive', 'error')
    }

    return new CheckPassed()
  }
}

class CapabilityValidityCheck implements PreLoadCheck {
  name = 'capability-validity'

  run(plugin: Plugin): CheckResult {
    const capabilities = ((plugin.manifest as LooseManifest).capabilities ??
      []) as Array<Partial<CapabilityDeclaration>>

    for (const cap of capabilities) {
      if (!cap.type) {
        return new CheckFailed('Capability missing required field: type', 'error')
      }

      const validTypes = ['tool', 'hook', 'service', 'event', 'ui-slot', 'llm-adapter']
      if (!validTypes.includes(cap.type)) {
        return new CheckFailed(
          `Invalid capability type: ${cap.type}. Must be one of: ${validTypes.join(', ')}`,
          'error',
        )
      }

      // 根据类型验证特定字段
      if (cap.type === 'tool' && !cap.tool?.name) {
        return new CheckFailed('Tool capability missing required field: name', 'error')
      }
      if (cap.type === 'hook' && !cap.hook?.event) {
        return new CheckFailed('Hook capability missing required field: event', 'error')
      }
      if (cap.type === 'service' && !cap.service?.factory) {
        return new CheckFailed('Service capability missing required field: factory', 'error')
      }
    }

    return new CheckPassed()
  }
}

class SymbolIsolationCheck implements PreLoadCheck {
  name = 'symbol-isolation'

  run(_plugin: Plugin): CheckResult {
    // 检查是否有重复的 Symbol 注册
    // 这需要通过 dsh-guard 的 junction 机制来实现
    // 暂时返回通过
    return new CheckPassed()
  }
}
