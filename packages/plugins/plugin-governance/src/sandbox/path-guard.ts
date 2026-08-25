/**
 * Shared sandbox filesystem gate.
 *
 * Single source of truth for both ProcessSandbox and InlineSandbox so their
 * path semantics cannot drift apart again: the allow list is matched with
 * resolved, component-complete prefixes and an EMPTY allow list denies
 * everything (fail closed), regardless of sandbox type or access mode.
 * @module @deepseek-ai/dsh-plugin-governance/sandbox/path-guard
 */

import { resolve } from 'path'
import type { PluginSandboxConfig } from '../spec/index.js'

/** The `filesystem` section of one sandbox config. */
type FilesystemConfig = PluginSandboxConfig['filesystem']

/**
 * Decide whether one absolute-or-relative plugin path may be touched.
 *
 * Security semantics:
 * - the candidate is normalized (`resolve`) so `..`/`.` components collapse;
 * - a literal `..`/`~` surviving in the result rejects defensively;
 * - configured deny patterns win over everything;
 * - allow-list entries must match as whole path segments (not raw string
 *   prefixes), so `/work` does not admit `/workshop`;
 * - an empty allow list denies every path — fail closed.
 * @param config - the `filesystem` section of the sandbox config to enforce.
 * @param path - the absolute-or-relative path a plugin wants to touch.
 * @returns whether the path may be touched under the configured rules.
 */
export function checkPathAllowed(config: FilesystemConfig, path: string): boolean {
  // 路径规范化：解析绝对路径并消除 .. 和 . 组件
  let normalizedPath: string
  try {
    normalizedPath = resolve(path)
    /* v8 ignore next 2 -- resolve() already collapses '..' and never emits '~'; this is defense-in-depth against exotic hosts. */
    if (normalizedPath.includes('..') || normalizedPath.includes('~')) {
      return false
    }
  } catch {
    /* v8 ignore next -- path.resolve only rejects on hostile custom fs; unreachable over real paths. */
    return false
  }

  // 检查拒绝模式
  for (const pattern of config.deniedPatterns) {
    try {
      const resolvedPattern = resolve(pattern)
      if (normalizedPath.includes(resolvedPattern)) {
        return false
      }
    } catch {
      /* v8 ignore next 2 -- resolve() of a configured deny pattern cannot fail on real inputs. */
      continue
    }
  }

  // 检查白名单（fail closed：未配置白名单时一律拒绝）
  if (config.allowedPaths.length === 0) return false

  const allowedResolved = config.allowedPaths.map((p) => {
    try {
      return resolve(p)
    } catch {
      /* v8 ignore next -- resolve() of a configured allow-list entry cannot fail on real inputs. */
      return p
    }
  })
  // 确保路径在白名单内（不是简单的前缀匹配，而是路径组件完整匹配）。
  // 两种分隔符都参与比较，避免平台差异造成分支不可达。
  return allowedResolved.some((p) => {
    const posixPrefix = p + '/'
    const win32Prefix = p + '\\'
    return (
      normalizedPath === p ||
      normalizedPath.startsWith(posixPrefix) ||
      normalizedPath.startsWith(win32Prefix)
    )
  })
}
