/**
 * InlineSandbox - 内联沙箱
 *
 * 为低风险插件提供主线执行环境，
 * 通过守卫机制进行监控。
 */

import { PluginSandboxConfig, ExecResult, ExecOptions, SandboxContext } from '../spec/index.js'
import { checkPathAllowed } from './path-guard.js'
import { deriveSandboxEnvironment } from './env.js'

export class InlineSandbox implements SandboxContext {
  private config: PluginSandboxConfig
  private pluginId: string

  constructor(pluginId: string, config: PluginSandboxConfig) {
    this.pluginId = pluginId
    this.config = config
  }

  /**
   * 执行命令
   * 安全修复：统一使用execFile，避免shell注入；子进程环境从白名单派生
   */
  async exec(command: string, options?: ExecOptions): Promise<ExecResult> {
    // 与 ProcessSandbox 相同的环境派生：必需项白名单 + 调用方覆盖项。
    const childEnv = {
      ...deriveSandboxEnvironment(this.config),
      ...(options?.env ?? {}),
    }

    // 完全授权模式：与 core 一致，但仍需安全执行
    if (this.config.process.fullyAuthorized) {
      const { execFile } = await import('child_process')
      const timeout = options?.timeout || this.config.resources.timeoutMs
      const start = Date.now()

      // 安全解析命令：拆分为可执行文件和参数
      const cmdParts = command.trim().split(/\s+/)
      const cmd = cmdParts[0] || ''
      const args = cmdParts.slice(1)

      return new Promise((resolve, reject) => {
        execFile(cmd, args, {
          timeout,
          maxBuffer: this.config.resources.maxOutputBytes * 2,
          ...(options?.cwd ? { cwd: options.cwd } : {}),
          env: childEnv,
        }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(error.message))
          } else {
            resolve({
              exitCode: 0,
              stdout: stdout.substring(0, this.config.resources.maxOutputBytes),
              stderr,
              duration: Date.now() - start,
            })
          }
        })
      })
    }

    // 普通模式：需要白名单检查
    if (!this.config.process.exec) {
      throw new Error(`exec() is not allowed for plugin ${this.pluginId}`)
    }

    // 安全解析命令
    const cmdParts = command.trim().split(/\s+/)
    const cmdBase = cmdParts[0] || ''
    const args = cmdParts.slice(1)

    if (!cmdBase || !this.config.process.allowedCommands.includes(cmdBase)) {
      throw new Error(`Command '${command}' is not in the allowed list`)
    }

    const { execFile } = await import('child_process')
    const timeout = options?.timeout || this.config.resources.timeoutMs
    const start = Date.now()

    return new Promise((resolve, reject) => {
      execFile(cmdBase, args, {
        timeout,
        maxBuffer: this.config.resources.maxOutputBytes * 2,
        ...(options?.cwd ? { cwd: options.cwd } : {}),
        env: childEnv,
      }, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(error.message))
        } else {
          resolve({
            exitCode: 0,
            stdout: stdout.substring(0, this.config.resources.maxOutputBytes),
            stderr,
            duration: Date.now() - start,
          })
        }
      })
    })
  }

  /**
   * 读取文件
   */
  async read(path: string): Promise<string> {
    // access 可能来自不受信的 JSON 配置，用宽松字符串比较做运行时闸门。
    const access = this.config.filesystem.access as string
    /* v8 ignore next 1 -- typed configs admit only readonly/readwrite; the second comparison guards decoded-JSON junk. */
    if (access === 'readonly' || access === 'readwrite') {
      if (this.isPathAllowed(path)) {
        const { readFileSync } = await import('fs')
        return readFileSync(path, 'utf-8')
      }
    }
    throw new Error(`Read access denied for path: ${path}`)
  }

  /**
   * 写入文件
   */
  async write(path: string, content: string): Promise<void> {
    if (this.config.filesystem.access === 'readwrite') {
      if (this.isPathAllowed(path)) {
        const { writeFileSync } = await import('fs')
        writeFileSync(path, content)
        return
      }
    }
    throw new Error(`Write access denied for path: ${path}`)
  }

  /**
   * 列出目录
   */
  async list(path: string): Promise<string[]> {
    const access = this.config.filesystem.access as string
    /* v8 ignore next 1 -- typed configs admit only readonly/readwrite; the second comparison guards decoded-JSON junk. */
    if (access === 'readonly' || access === 'readwrite') {
      if (this.isPathAllowed(path)) {
        const { readdirSync } = await import('fs')
        return readdirSync(path)
      }
    }
    throw new Error(`List access denied for path: ${path}`)
  }

  /**
   * 检查路径是否允许（与 ProcessSandbox 共享同一 fail-closed 闸门：
   * 白名单为空时一律拒绝，而不是放行任意路径）
   */
  isPathAllowed(path: string): boolean {
    return checkPathAllowed(this.config.filesystem, path)
  }
}
