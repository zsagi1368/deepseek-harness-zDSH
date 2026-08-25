/**
 * Tool context and result types
 */
import type { ImageAttachment } from '../config/types.js'

/** The context handed to a tool handler: bridge, image, and query. */
export interface ToolContext {
  bridge: import('../bridge/vision-bridge.js').VisionBridge
  image: ImageAttachment
  query?: string
}

/** The outcome of a tool invocation. */
export interface ToolResult {
  ok: boolean
  data?: unknown
  error?: string
}

/** The declarative shape of an omnivision tool. */
export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult>
}

// Note: Tool implementations are handled directly by executeWithFailover in plugin.callTool().
// The TOOLS array is intentionally omitted — tool dispatch is done via the failover chain.
