// DSH Omnivision — Next-gen vision plugin for DeepSeek Harness
// KV-cache safe by design: all image processing happens before DeepSeek sees the request.

export type { OmniVisionConfig } from './config/schema.js'
export type {
  FailureKind,
  ImageAttachment,
  RoutingMode,
  VisionDescription,
  VisionMode,
} from './config/types.js'
export type { PluginContext } from './plugin/index.js'
export { createOmnivisionPlugin, OmniVisionPlugin } from './plugin/index.js'
export type { ToolContext, ToolResult } from './tools/types.js'
export type { VisionFailure, VisionProvider, VisionResult } from './vision/provider.js'
