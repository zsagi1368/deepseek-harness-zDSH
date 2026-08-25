// Core types for DSH Omnivision

/** When the plugin analyzes images: automatic, interactive, or manual. */
export type VisionMode = 'auto' | 'interactive' | 'manual'
/** Where in the message pipeline vision analysis is inserted. */
export type RoutingMode = 'pre-step' | 'tool-call' | 'hybrid'
/** The taxonomy of vision request failures used for routing and advice. */
export type FailureKind =
  | 'AUTH'
  | 'RATE_LIMIT'
  | 'TIMEOUT'
  | 'SERVER'
  | 'INVALID_REQUEST'
  | 'NETWORK'
  | 'QUOTA'
  | 'REGION'
  | 'TOS'
  | 'NO_ADAPTER'
  | 'REPETITION'
  | 'BUDGET'
  | 'OTHER'

/** A vision backend adapter: executes requests and reports failures. */
export interface VisionProvider {
  name: string
  defaultModel: string
  category: 'api' | 'local' | 'free'
  speedClass: 'fast' | 'medium' | 'slow'
  execute(options: VisionExecuteOptions): Promise<VisionResult>
  describeFailure?(context: FailureContext): string | null
  healthCheck?(): Promise<boolean>
}

/** Options for a single vision provider execution. */
export interface VisionExecuteOptions {
  images: ImageSource[]
  query?: string
  tool?: string
  parameters?: Record<string, unknown>
  signal?: AbortSignal
  timeoutMs?: number
  /**
   * Additional readable roots (resolved, segment-checked) for local image
   * reads on top of the built-in temp locations; providers reject anything
   * outside these with PATH_DENIED.
   */
  allowedPaths?: readonly string[]
}

/** An image fed to vision: local path, remote URL, or inline base64. */
export interface ImageSource {
  kind: 'local' | 'remote' | 'inline'
  path?: string
  url?: string
  base64?: string
  mime?: string
  contentHash: string
  width?: number
  height?: number
}

/** The outcome of a vision request with provider metadata and failures. */
export interface VisionResult {
  ok: boolean
  data?: unknown
  meta: {
    provider: string
    model: string
    durationMs: number
    tokensUsed?: number
    cacheHit?: boolean
  }
  errors?: VisionFailure[]
}

/** A classified vision failure with retry guidance. */
export interface VisionFailure {
  kind: FailureKind
  code: string
  message: string
  retryable: boolean
  advice?: string
  attempted?: AttemptRecord[]
}

/** One provider attempt inside a failover sequence. */
export interface AttemptRecord {
  provider: string
  ok: boolean
  failure?: VisionFailure
  error?: string
}

/** The process context a failure classifier inspects for advice. */
export interface FailureContext {
  stdout: string
  stderr: string
  code: number | null
  startedAt?: number
}

/** The structured description of what an image shows. */
export interface VisionDescription {
  summary: string
  ocr?: string
  regions?: Array<{ type: string; text: string; order: number }>
  entities?: Array<{ name: string; type: string; evidence?: string }>
  uncertainty?: string[]
  raw?: unknown
}

/** A persisted image attachment with its verified content hash. */
export interface ImageAttachment {
  path: string
  contentHash: string
  mime: string
  bytes: number
  width?: number
  height?: number
}

/** Messages rewritten with vision descriptions replacing raw images. */
export interface ProcessedMessages {
  messages: Array<{ role: string; content: string; attachments?: unknown[] }>
  imageCount: number
  descriptions: VisionDescription[]
}

/** The normalized runtime configuration of the omnivision plugin. */
export interface PluginConfig {
  mode: VisionMode
  routing: RoutingMode
  providers: Array<{ name: string; model?: string; apiKeyEnv?: string; baseUrl?: string }>
  localOllama: { enabled: boolean; baseURL: string; model: string }
  freeFallback: boolean
  maxImageBytes: number
  maxImagePixels: number
  downscale: boolean
  cache: boolean
  cacheTtlSeconds: number
  timeoutMs: number
  visionTaskTimeoutMs: number
  language: 'zh' | 'en'
  artifactsDir: string
  visionDepth: 'fast' | 'standard' | 'deep'
}
