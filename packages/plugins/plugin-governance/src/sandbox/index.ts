/**
 * Sandbox - 沙箱工厂
 *
 * 根据插件配置选择合适的沙箱类型。
 */

import { PluginSandboxConfig, SandboxContext } from '../spec/index.js'
import { ProcessSandbox } from './process-sandbox.js'
import { WorkerSandbox } from './worker-sandbox.js'
import { InlineSandbox } from './inline-sandbox.js'

/**
 * 创建沙箱实例
 */
export function createSandbox(
  pluginId: string,
  config: PluginSandboxConfig,
  entryPoint?: string,
): SandboxContext {
  switch (config.type) {
    case 'process':
      if (!entryPoint) {
        throw new Error('entryPoint is required for process sandbox')
      }
      return new ProcessSandbox(pluginId, config, entryPoint)

    case 'worker':
      if (!entryPoint) {
        throw new Error('entryPoint is required for worker sandbox')
      }
      return new WorkerSandbox(pluginId, config, entryPoint)

    case 'inline':
      return new InlineSandbox(pluginId, config)

    default:
      throw new Error(`Unknown sandbox type: ${config.type}`)
  }
}

/**
 * 根据风险等级选择沙箱类型
 */
export function selectSandboxType(config: PluginSandboxConfig): PluginSandboxConfig {
  // 高风险插件使用进程隔离
  if (config.process.spawn || config.process.exec || config.network.access !== 'none') {
    return { ...config, type: 'process' }
  }

  // 中等风险使用 Worker Thread
  if (config.filesystem.access === 'readwrite') {
    return { ...config, type: 'worker' }
  }

  // 低风险可以直接在主线运行
  return { ...config, type: 'inline' }
}

export { ProcessSandbox } from './process-sandbox.js'
export { WorkerSandbox } from './worker-sandbox.js'
export { InlineSandbox } from './inline-sandbox.js'
export { checkPathAllowed } from './path-guard.js'
export { deriveSandboxEnvironment } from './env.js'
