/**
 * Plugin configuration schema
 */

export interface OmniVisionConfig {
  // Mode: how the plugin interacts with DeepSeek
  mode: 'auto' | 'interactive' | 'manual'
  // Routing: how images are processed
  routing: 'pre-step' | 'tool-call' | 'hybrid'
  // Custom providers (highest priority)
  providers: Array<{
    name: string
    model?: string
    apiKeyEnv?: string
    baseUrl?: string
  }>
  // Local Ollama backend
  localOllama: {
    enabled: boolean
    baseURL: string
    model: string
  }
  // Local LM Studio backend
  localLmStudio: {
    enabled: boolean
    baseURL: string
    model: string
  }
  // Free fallback chain
  freeFallback: boolean
  freeCloudFirst: boolean
  // Image processing limits
  maxImageBytes: number
  maxImagePixels: number
  downscale: boolean
  downscaleMaxPixels: number
  // Cache
  cache: boolean
  cacheTtlSeconds: number
  cacheMaxEntries: number
  cacheMaxBytes: number
  // Timeouts
  timeoutMs: number
  visionTaskTimeoutMs: number
  ocrTimeoutMs: number
  // Output
  language: 'zh' | 'en'
  artifactsDir: string
  // Vision depth
  visionDepth: 'fast' | 'standard' | 'deep'
  // Progressive tool exposure
  progressiveTools: boolean
}

/**
 * Default configuration — safe for production use
 */
export const DEFAULT_CONFIG: OmniVisionConfig = {
  mode: 'auto',
  routing: 'pre-step',
  providers: [],
  localOllama: { enabled: false, baseURL: 'http://127.0.0.1:11434/v1', model: 'qwen2.5-vl:7b' },
  localLmStudio: { enabled: false, baseURL: 'http://localhost:1234/v1', model: 'qwen2.5-vl-7b' },
  freeFallback: true,
  freeCloudFirst: false,
  maxImageBytes: 4 * 1024 * 1024,
  maxImagePixels: 20_000_000,
  downscale: true,
  downscaleMaxPixels: 4_000_000,
  cache: true,
  cacheTtlSeconds: 3600,
  cacheMaxEntries: 200,
  cacheMaxBytes: 512 * 1024 * 1024,
  timeoutMs: 120_000,
  visionTaskTimeoutMs: 45_000,
  ocrTimeoutMs: 30_000,
  language: 'zh',
  artifactsDir: '.dsh-omnivision/artifacts',
  visionDepth: 'standard',
  progressiveTools: false,
}

/**
 * Validate config and return warnings for problematic settings
 * @param config - the configuration to validate.
 * @returns the list of warnings for problematic settings.
 */
export function validateConfig(config: OmniVisionConfig): string[] {
  const warnings: string[] = []

  // Check provider configs
  for (const p of config.providers) {
    if (p.apiKeyEnv && !process.env[p.apiKeyEnv]) {
      warnings.push(`Warning: ${p.apiKeyEnv} not set in environment`)
    }
  }

  // Check image limits
  if (config.maxImageBytes > 25 * 1024 * 1024) {
    warnings.push('Warning: maxImageBytes > 25MB may cause memory issues')
  }

  if (config.maxImagePixels > 100_000_000) {
    warnings.push('Warning: maxImagePixels > 100MP may cause OOM')
  }

  return warnings
}
