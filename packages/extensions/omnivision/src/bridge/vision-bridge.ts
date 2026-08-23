/**
 * Vision Bridge — Core innovation of DSH Omnivision
 *
 * All image processing happens BEFORE DeepSeek sees the request.
 * DeepSeek always receives pure text → KV cache never affected.
 */
import { createHash } from 'node:crypto'
import type { ImageAttachment, VisionDescription, VisionExecuteOptions } from '../config/types.js'
import type { VisionCircuitBreaker } from '../resilience/circuit.js'
import { executeWithFailover } from '../vision/chain.js'
import type { VisionProvider } from '../vision/provider.js'

interface CacheEntry {
  description: VisionDescription
  expiresAt: number
}

export interface ImageProcessingTask {
  image: ImageAttachment
  query: string
  status: 'pending' | 'processing' | 'done' | 'failed'
  result?: VisionDescription
  error?: string
}

const MAX_CACHE_ENTRIES = 100

export class VisionBridge {
  private completedResults = new Map<string, CacheEntry>()
  private readonly defaultTtlMs = 3600_000 // 1 hour

  constructor(
    private providers: VisionProvider[],
    private mode: 'auto' | 'interactive' | 'manual',
    private sessionId?: string,
    private circuitBreaker?: VisionCircuitBreaker,
  ) {}

  /**
   * Process images and return descriptions.
   * Failed images return error descriptions instead of throwing.
   */
  async processImages(
    images: ImageAttachment[],
    query: string,
    signal?: AbortSignal,
  ): Promise<VisionDescription[]> {
    if (images.length === 0) return []

    // Manual mode: no processing
    if (this.mode === 'manual') return []

    const results = await Promise.allSettled(
      images.map(img => this.processSingleImage(img, query, signal)),
    )

    const descriptions: VisionDescription[] = []
    for (const result of results) {
      if (result.status === 'fulfilled') {
        descriptions.push(result.value)
      }
      // Failed images: null is skipped, user sees no marker
    }
    return descriptions
  }

  /**
   * Generate brief summary for interactive mode
   */
  async processSummary(
    images: ImageAttachment[],
    query: string,
    signal?: AbortSignal,
  ): Promise<string> {
    const descriptions = await this.processImages(images, query, signal)
    if (descriptions.length === 0) return ''
    return descriptions.map(d => d.summary).join('。')
  }

  /**
   * Create stable cache key — contentHash + query intent hash
   * Same image + similar intent → higher hit rate
   */
  private createCacheKey(image: ImageAttachment, query: string): string {
    return createHash('sha256')
      .update(this.sessionId ?? 'default')
      .update(this.mode)
      .update(image.contentHash)
      .update(query.slice(0, 32)) // first 32 chars as intent signal
      .digest('hex')
      .slice(0, 16)
  }

  /**
   * Process single image with failover chain (chain.ts)
   * Returns error description on failure instead of throwing
   */
  private async processSingleImage(
    image: ImageAttachment,
    query: string,
    signal?: AbortSignal,
  ): Promise<VisionDescription> {
    const cacheKey = this.createCacheKey(image, query)

    // Check cache with TTL
    const cached = this.getFromCache(cacheKey)
    if (cached) return cached

    try {
      const options: VisionExecuteOptions = {
        images: [
          {
            kind: 'local' as const,
            path: image.path,
            contentHash: image.contentHash,
            mime: image.mime,
          },
        ],
        query,
        tool: 'vision_describe',
        ...(signal !== undefined && { signal }),
        timeoutMs: 45_000,
      }

      const result = await executeWithFailover(
        this.providers,
        options,
        { totalTimeoutMs: 120_000, providerTimeoutMs: 45_000 },
        this.circuitBreaker,
      )

      if (result.ok && result.data) {
        const description = this.extractDescription(result.data)
        this.setCache(cacheKey, description)
        return description
      }

      // All providers failed — return error description
      const lastError = result.errors?.[0]?.message ?? 'Unknown error'
      return {
        summary: `[Vision error: ${lastError}]`,
        uncertainty: [lastError],
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      if (msg === 'Cancelled') throw error // propagate abort
      return { summary: `[Vision error: ${msg}]`, uncertainty: [msg] }
    }
  }

  private getFromCache(key: string): VisionDescription | undefined {
    const entry = this.completedResults.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.completedResults.delete(key)
      return undefined
    }
    return entry.description
  }

  private setCache(key: string, description: VisionDescription): void {
    // LRU eviction: remove oldest if at capacity
    if (this.completedResults.size >= MAX_CACHE_ENTRIES) {
      const oldestKey = this.completedResults.keys().next().value
      if (oldestKey) this.completedResults.delete(oldestKey)
    }
    this.completedResults.set(key, {
      description,
      expiresAt: Date.now() + this.defaultTtlMs,
    })
  }

  private extractDescription(data: unknown): VisionDescription {
    if (!data || typeof data !== 'object') {
      return { summary: 'Image processed (no structured data)' }
    }
    const d = data as Record<string, unknown>
    return {
      summary: (d.summary as string | undefined) ?? 'Image content processed',
      ocr: (d.ocr ?? undefined) as string,
      regions: (d.regions ?? undefined) as Array<{ type: string; text: string; order: number }>,
      entities:
        (d.entities ?? undefined) as Array<{ name: string; type: string; evidence?: string }>,
      uncertainty: (d.uncertainty ?? undefined) as string[],
      raw: d,
    }
  }

  clear(): void {
    this.completedResults.clear()
  }

  stats(): { cached: number } {
    return { cached: this.completedResults.size }
  }
}
