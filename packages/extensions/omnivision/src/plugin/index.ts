/**
 * Plugin entry point — Main DSH integration
 */

import { readFileSync } from 'node:fs'
import { createShadowReplacements } from '../bridge/shadow-history.js'
import { VisionBridge } from '../bridge/vision-bridge.js'
import type { OmniVisionConfig } from '../config/schema.js'
import { VisionCircuitBreaker } from '../resilience/circuit.js'
import { PathPolicy } from '../security/index.js'
import { executeWithFailover } from '../vision/chain.js'
import {
  anthropicProvider,
  assertReadableImagePath,
  geminiProvider,
  openaiProvider,
  ovhProvider,
  zhipuProvider,
} from '../vision/providers.js'
import type { VisionProvider } from '../vision/provider.js'

/** The runtime context a plugin instance is built from. */
export interface PluginContext {
  config: OmniVisionConfig
  workspace: string
  sessionId?: string
  /** Optional additional providers (e.g. mock providers for testing) */
  extraProviders?: VisionProvider[]
}

/**
 * The DSH plugin facade: rewrites image-bearing messages to pure text and
 * exposes a vision tool, all behind the shared security and resilience layers.
 */
export class OmniVisionPlugin {
  private bridge: VisionBridge
  private circuitBreaker: VisionCircuitBreaker
  private providers: VisionProvider[]
  /** One policy instance owns path admission for every entry of this plugin. */
  private readonly pathPolicy: PathPolicy

  constructor(private ctx: PluginContext) {
    this.circuitBreaker = new VisionCircuitBreaker()
    this.providers = this.composeProviders()
    this.bridge = new VisionBridge(
      this.providers,
      ctx.config.mode,
      ctx.sessionId,
      this.circuitBreaker,
    )
    this.pathPolicy = new PathPolicy(ctx.workspace)
  }

  private composeProviders(): VisionProvider[] {
    const providers: VisionProvider[] = []

    // Extra providers (e.g. mock for testing) injected via context
    if (this.ctx.extraProviders) {
      providers.push(...this.ctx.extraProviders)
    }

    for (const p of this.ctx.config.providers) {
      if (p.name === 'openai') {
        providers.push(p.baseUrl || p.model ? createDynamicProvider('openai', p.baseUrl, p.model) : openaiProvider)
      } else if (p.name === 'anthropic') {
        providers.push(p.baseUrl || p.model ? createDynamicProvider('anthropic', p.baseUrl, p.model) : anthropicProvider)
      } else if (p.name === 'gemini') {
        providers.push(p.baseUrl || p.model ? createDynamicProvider('gemini', p.baseUrl, p.model) : geminiProvider)
      } else {
        // Unknown provider name — skip (will fail gracefully at execution)
        providers.push(createUnknownProvider(p.name, p.baseUrl, p.model))
      }
    }
    if (this.ctx.config.freeFallback) {
      providers.push(ovhProvider)
      if (process.env.ZAI_API_KEY) providers.push(zhipuProvider)
    }
    return providers
  }

  /**
   * Process a message's image attachments into text descriptions.
   * @param content - the original message content.
   * @param attachments - the raw attachment objects carrying image paths.
   * @param eventId - the originating event id, used for shadow replacements.
   * @returns the rewrite outcome with markers, counts, and error flags.
   */
  async processMessage(
    content: string,
    attachments: unknown[] = [],
    eventId?: string,
  ): Promise<{
    rewritten: boolean
    newContent: string
    imageCount: number
    descriptions: string[]
    shadows?: Array<{ surfaceOp: unknown; modelOp: unknown }>
    hasErrors: boolean
  }> {
    // Validate attachment paths
    const policy = this.pathPolicy
    const validAttachments = attachments.filter((a): a is { path: string; contentHash: string; mime?: string; bytes?: number } => {
      if (typeof a !== 'object' || a === null || !('path' in a) || !('contentHash' in a)) return false
      const path = (a as { path: string }).path
      return policy.allowInput(path)
    })

    if (validAttachments.length === 0) {
      return { rewritten: false, newContent: content, imageCount: 0, descriptions: [], hasErrors: false }
    }

    // Enforce maxImageBytes from config
    const maxBytes = this.ctx.config.maxImageBytes
    for (const att of validAttachments) {
      if (maxBytes > 0 && (att.bytes ?? 0) > maxBytes) {
        validAttachments.splice(validAttachments.indexOf(att), 1)
      }
    }

    if (validAttachments.length === 0) {
      return { rewritten: false, newContent: content, imageCount: 0, descriptions: [], hasErrors: false }
    }

    // Read real file metadata for attachments without it
    const imageInfos = validAttachments.map(img => ({
      path: img.path,
      contentHash: img.contentHash,
      mime: img.mime ?? 'image/png',
      bytes: img.bytes ?? 0,
    }))

    const descriptions = await this.bridge.processImages(imageInfos, content)

    // Separate successful descriptions from error ones
    const successDescs = descriptions.filter(d => !d.summary.startsWith('[Vision error:'))
    const errorDescs = descriptions.filter(d => d.summary.startsWith('[Vision error:'))
    const hasErrors = errorDescs.length > 0

    const markers = descriptions.map((d, i) => `[已识图${i + 1}: ${d.summary}]`).join('\n\n')
    const newContent =
      descriptions.length === 1
        ? `${content}\n\n${markers}`
        : `${content}\n\n已识图${descriptions.length}张：\n${markers}`

    // Create shadow replacements — one per image for proper UI/model separation
    const shadows = eventId
      ? createShadowReplacements(
        eventId,
        imageInfos,
        descriptions.map(d => d.summary),
      )
      : undefined

    return {
      rewritten: true,
      newContent,
      imageCount: validAttachments.length,
      descriptions: successDescs.map(d => d.summary),
      ...(shadows !== undefined && { shadows }),
      hasErrors,
    }
  }

  /**
   * Run the vision tool over untrusted tool arguments.
   * @param tool - the tool name being invoked.
   * @param args - raw tool arguments, narrowed and path-gated before use.
   * @returns the failover chain result for the request.
   */
  async callTool(tool: string, args: Record<string, unknown>): Promise<unknown> {
    // PathPolicy gate: tool-supplied local image paths never reach a provider
    // unless they sit inside the workspace or temp locations.
    const allowed = this.pathPolicy.allowInput.bind(this.pathPolicy)
    const imagesArg = args.images as Array<unknown> | undefined
    const images = (imagesArg ?? []).flatMap((raw) => {
      // Tool arguments are untrusted at runtime despite the wire shape, so
      // every entry is narrowed before use and malformed ones simply drop.
      if (typeof raw !== 'object' || raw === null) return []
      const candidate = raw as { path?: unknown }
      if (typeof candidate.path !== 'string') return []
      if (!allowed(candidate.path)) {
        // An over-privileged image path must not vanish silently (N-05).
        console.warn(`[omnivision] rejected unauthorized image path ${JSON.stringify(candidate.path)}`)
        return []
      }
      const img = raw as { path: string; contentHash: string; mime?: string }
      return [{
        kind: 'local' as const,
        path: img.path,
        contentHash: img.contentHash,
        ...(img.mime !== undefined && { mime: img.mime }),
      }]
    })

    return executeWithFailover(
      this.providers,
      {
        images,
        query: args.query as string,
        tool,
        parameters: args,
        // Providers re-check every local read against these roots.
        allowedPaths: [this.ctx.workspace],
      },
      {
        totalTimeoutMs: this.ctx.config.timeoutMs,
        providerTimeoutMs: this.ctx.config.visionTaskTimeoutMs,
      },
      this.circuitBreaker,
    )
  }

  /**
   * Current plugin occupancy across cache, circuit, and provider count.
   * @returns the aggregated stats snapshot.
   */
  stats(): {
    cache: { cached: number }
    circuit: { blocked: string[]; total: number }
    providers: number
  } {
    return {
      cache: this.bridge.stats(),
      circuit: this.circuitBreaker.stats(),
      providers: this.providers.length,
    }
  }

  /** Drop all cached state held by the bridge and circuit breaker. */
  dispose(): void {
    this.bridge.clear()
    this.circuitBreaker.clear()
  }
}

/**
 * Create a dynamic provider with custom baseUrl/model
 */
function createDynamicProvider(
  baseName: string,
  baseUrl?: string,
  model?: string,
): VisionProvider {
  // Dynamic providers use OpenAI-compatible API format
  return {
    name: baseName,
    defaultModel: model ?? 'custom',
    category: 'api' as const,
    speedClass: 'fast' as const,
    async execute(options) {
      const targetUrl = baseUrl
        ? `${baseUrl.replace(/\/$/, '')}/chat/completions`
        : `https://api.${baseName}.com/v1/chat/completions`
      const apiKey = process.env[`${baseName.toUpperCase()}_API_KEY`]
        ?? process.env.OPENAI_API_KEY
        ?? ''
      const promptModel = model ?? 'custom-model'

      try {
        const contents: Array<{ type: string; text?: string; image_url?: { url: string } }> = []
        if (options.query) contents.push({ type: 'text', text: options.query })
        for (const img of options.images) {
          if (img.kind === 'local' && img.path) {
            const ext = img.path.toLowerCase().split('.').pop() ?? ''
            const mimeMap: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' }
            const mime = img.mime || mimeMap[ext] || 'image/png'
            // Same gate as the fixed providers: temp roots plus the
            // caller-declared workspace, segment-checked, lstat-verified.
            const base64 = readFileSync(assertReadableImagePath(img.path, options.allowedPaths)).toString('base64')
            contents.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } })
          }
        }
        const resp = await fetch(targetUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: promptModel, messages: [{ role: 'user', content: contents }] }),
          signal: options.signal ?? null,
          redirect: 'manual',
        })
        if (!resp.ok) return { ok: false, meta: { provider: baseName, model: promptModel, durationMs: 0 }, errors: [{ kind: 'SERVER' as const, code: 'DYNAMIC_API_ERROR', message: `HTTP ${resp.status}`, retryable: true }] }
        const data = await resp.json() as { choices?: Array<{ message?: { content: string } }> }
        const text = data.choices?.[0]?.message?.content ?? ''
        return { ok: true, data: { summary: text }, meta: { provider: baseName, model: promptModel, durationMs: 0 } }
      } catch {
        return { ok: false, meta: { provider: baseName, model: promptModel, durationMs: 0 }, errors: [{ kind: 'NETWORK' as const, code: 'DYNAMIC_NETWORK_ERROR', message: 'Network error', retryable: true }] }
      }
    },
  }
}

function createUnknownProvider(name: string, _baseUrl?: string, model?: string): VisionProvider {
  return {
    name,
    defaultModel: model ?? 'unknown',
    category: 'api' as const,
    speedClass: 'slow' as const,
    execute() {
      return Promise.resolve({ ok: false, meta: { provider: name, model: 'unknown', durationMs: 0 }, errors: [{ kind: 'NO_ADAPTER' as const, code: 'UNKNOWN_PROVIDER', message: `Provider "${name}" is not implemented`, retryable: false }] })
    },
  }
}

/**
 * Build a plugin instance for the given context.
 * @param ctx - the runtime context with config and workspace.
 * @returns a configured omnivision plugin instance.
 */
export function createOmnivisionPlugin(ctx: PluginContext): OmniVisionPlugin {
  return new OmniVisionPlugin(ctx)
}
