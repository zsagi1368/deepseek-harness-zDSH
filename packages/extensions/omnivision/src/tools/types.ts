/**
 * Tool context and result types
 */
import type { ImageAttachment } from '../config/types.js'

export interface ToolContext {
  bridge: import('../bridge/vision-bridge.js').VisionBridge
  image: ImageAttachment
  query?: string
}

export interface ToolResult {
  ok: boolean
  data?: unknown
  error?: string
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  handler: (ctx: ToolContext, args: Record<string, unknown>) => Promise<ToolResult>
}

// Note: Tool implementations are handled directly by executeWithFailover in plugin.callTool().
// The TOOLS array is intentionally omitted — tool dispatch is done via the failover chain.
