/**
 * Project tool wrapper — a `tools/execute` around-dispatch waterfall listener
 * (B-08). Every project plugin tool call is routed through the RunGuard; non-
 * project tools pass through with zero behavior change (D-01).
 *
 * When a project tool's RunGuard watcher throws a PluginTimeoutError or
 * PluginError (call count exceeded, etc.), the wrapper maps it to a structured
 * isError result instead of letting it propagate to the agent loop.
 * @module @deepseek-ai/dsh-plugin-project-root
 */

import type { Context } from '@deepseek-ai/cordis'
import { RunGuard, PluginError, PluginTimeoutError } from '@deepseek-ai/dsh-plugin-governance'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'

/** Dependencies needed by the project tool wrapper. */
export interface ProjectToolGuardContext {
  /** Resolve tool name → canonical manifest id (undefined = not a project tool). */
  toolOwnerOf(toolName: string): string | undefined
  /** The RunGuard instance that watches every mounted project plugin. */
  runGuard: RunGuard
}

/**
 * Register a `tools/execute` around-dispatch listener that wraps every tool
 * call attributed to a project plugin through the RunGuard.
 *
 * @param ctx - the boot context to register on.
 * @param deps - tool owner lookup and RunGuard.
 * @returns a disposer that removes the listener.
 */
export function projectToolWrapper(
  ctx: Context,
  deps: ProjectToolGuardContext,
): () => void {
  return ctx.on('tools/execute', async (exec, next): Promise<ToolExecutionResult> => {
    const pluginId = deps.toolOwnerOf(exec.name)
    // Non-project tool: zero behavior change (D-01).
    if (pluginId === undefined) return next()
    try {
      return await deps.runGuard.execute(pluginId, () => next())
    } catch (error) {
      // PluginTimeoutError: the watcher's Promise.race fired; the tool body may
      // still be running (M2a in-process semantics), but the caller sees a
      // structured timeout error, never a thrown exception.
      if (error instanceof PluginTimeoutError) {
        return {
          content: [{ type: 'text', text: `Error: project plugin ${JSON.stringify(pluginId)} timed out` }],
          isError: true,
          error: {
            message: error.message,
            info: { name: 'PluginTimeoutError', code: 'PLUGIN_TIMEOUT' },
          },
        }
      }
      // PluginError (call count exceeded, body error, etc.): map to structured
      // governance error result.
      if (error instanceof PluginError) {
        return {
          content: [{ type: 'text', text: `Error: ${error.message}` }],
          isError: true,
          error: {
            message: error.message,
            info: { name: 'PluginError', code: 'PLUGIN_GOVERNANCE' },
          },
        }
      }
      // Unexpected (non-PluginError) errors: let them propagate — these are
      // wiring bugs, not plugin governance events.
      throw error
    }
  }, { global: true })
}
