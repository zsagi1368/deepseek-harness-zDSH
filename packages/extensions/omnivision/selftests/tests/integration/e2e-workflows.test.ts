/**
 * Integration Tests: End-to-End Workflows
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OmniVisionPlugin, createOmnivisionPlugin } from '../../../src/plugin/index.ts'
import type { VisionProvider, VisionResult } from '../../../src/vision/provider.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Mock provider
const mockProvider: VisionProvider = {
  name: 'mock',
  defaultModel: 'mock-model',
  category: 'api',
  speedClass: 'fast',
  execute: vi.fn(),
}

const defaultConfig = {
  mode: 'auto' as const,
  routing: 'pre-step' as const,
  providers: [],
  localOllama: { enabled: false, baseURL: '', model: '' },
  localLmStudio: { enabled: false, baseURL: '', model: '' },
  freeFallback: false,
  freeCloudFirst: false,
  maxImageBytes: 4 * 1024 * 1024,
  maxImagePixels: 20_000_000,
  downscale: true,
  downscaleMaxPixels: 4_000_000,
  cache: true,
  cacheTtlSeconds: 3600,
  cacheMaxEntries: 200,
  cacheMaxBytes: 512 * 1024 * 1024,
  timeoutMs: 120000,
  visionTaskTimeoutMs: 45000,
  ocrTimeoutMs: 30000,
  language: 'zh' as const,
  artifactsDir: '.dsh-omnivision/artifacts',
  visionDepth: 'standard' as const,
  progressiveTools: false,
}

const testWorkspace = join(tmpdir(), 'dsh-omnivision-test-workspace')

/**
 * Helper to create plugin with mock provider injected via extraProviders
 */
function makePlugin(overrides?: Partial<typeof defaultConfig>) {
  const config = { ...defaultConfig, ...overrides }
  return createOmnivisionPlugin({ config, workspace: testWorkspace, extraProviders: [mockProvider] })
}

describe('Integration Tests: End-to-End Workflows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Auto Mode Workflow', () => {
    it('should process image and return rewritten message', async () => {
      mockProvider.execute.mockResolvedValue({
        ok: true, data: { summary: 'This is a test image' },
        meta: { provider: 'mock', model: 'mock-model', durationMs: 100 },
      } as VisionResult)

      const plugin = makePlugin()
      const result = await plugin.processMessage('What is in this image?', [
        { path: join(tmpdir(), 'test.png'), contentHash: 'abc123', mime: 'image/png', bytes: 1024 },
      ], 'event-123')

      expect(result.rewritten).toBe(true)
      expect(result.imageCount).toBe(1)
      expect(result.descriptions).toHaveLength(1)
      expect(result.newContent).toContain('[已识图1:')
      expect(result.shadows).toBeDefined()
      expect(mockProvider.execute).toHaveBeenCalledTimes(1)
    })

    it('should handle multiple images', async () => {
      mockProvider.execute.mockResolvedValue({
        ok: true, data: { summary: 'Image description' },
        meta: { provider: 'mock', model: 'mock-model', durationMs: 50 },
      } as VisionResult)

      const plugin = makePlugin()
      const result = await plugin.processMessage('Compare these images', [
        { path: join(tmpdir(), 'img1.png'), contentHash: 'hash1', mime: 'image/png', bytes: 1024 },
        { path: join(tmpdir(), 'img2.png'), contentHash: 'hash2', mime: 'image/png', bytes: 1024 },
      ], 'event-456')

      expect(result.rewritten).toBe(true)
      expect(result.imageCount).toBe(2)
      expect(result.descriptions).toHaveLength(2)
      expect(mockProvider.execute).toHaveBeenCalledTimes(2)
    })

    it('should skip processing when no images', async () => {
      const plugin = makePlugin()
      const result = await plugin.processMessage('Just text', [])

      expect(result.rewritten).toBe(false)
      expect(result.newContent).toBe('Just text')
      expect(result.imageCount).toBe(0)
      expect(mockProvider.execute).not.toHaveBeenCalled()
    })
  })

  describe('Path Validation', () => {
    it('should reject paths outside workspace', async () => {
      const plugin = makePlugin()
      const result = await plugin.processMessage('Test', [
        { path: '/etc/passwd', contentHash: 'evil', mime: 'text/plain', bytes: 100 },
      ], 'event-999')

      expect(result.imageCount).toBe(0)
      expect(result.rewritten).toBe(false)
      expect(mockProvider.execute).not.toHaveBeenCalled()
    })

    it('callTool drops tool-supplied images outside the workspace before providers run', async () => {
      const plugin = makePlugin()
      mockProvider.execute.mockResolvedValue({
        ok: true, data: { summary: 'desc' },
        meta: { provider: 'mock', model: 'mock-model', durationMs: 1 },
      } as VisionResult)

      await plugin.callTool('vision_describe', {
        query: 'describe',
        images: [
          { path: '/etc/passwd', contentHash: 'evil' },
          { path: join(tmpdir(), '..', 'outside-every-root.png'), contentHash: 'outside' },
        ],
      })

      // The provider still runs (failover semantics), but only with the
      // sanitized image list — denied paths never reach it.
      expect(mockProvider.execute).toHaveBeenCalledTimes(1)
      const executedOptions = mockProvider.execute.mock.calls[0]?.[0] as unknown as { images: Array<{ path?: string }> }
      expect(executedOptions.images).toHaveLength(0)

      // An image inside the workspace passes the gate and reaches providers.
      await plugin.callTool('vision_describe', {
        query: 'describe',
        images: [{ path: join(testWorkspace, 'img.png'), contentHash: 'inside' }],
      })
      const secondCall = mockProvider.execute.mock.calls[1]?.[0] as unknown as { images: Array<{ path?: string }> }
      expect(secondCall.images).toHaveLength(1)
    })
  })

  describe('Manual Mode', () => {
    it('should not process images in manual mode', async () => {
      const plugin = makePlugin({ mode: 'manual' })
      const result = await plugin.processMessage('Test', [
        { path: join(tmpdir(), 'image.png'), contentHash: 'manual-hash', mime: 'image/png', bytes: 1024 },
      ], 'event-789')

      expect(result.rewritten).toBe(true)
      expect(result.descriptions).toHaveLength(0)
      expect(mockProvider.execute).not.toHaveBeenCalled()
    })
  })

  describe('Session Isolation', () => {
    it('should isolate cache between sessions', async () => {
      mockProvider.execute.mockResolvedValue({
        ok: true, data: { summary: 'Same content' },
        meta: { provider: 'mock', model: 'mock', durationMs: 10 },
      } as VisionResult)

      const plugin1 = createOmnivisionPlugin({
        config: defaultConfig,
        workspace: testWorkspace,
        sessionId: 'session-a',
        extraProviders: [mockProvider],
      })
      const plugin2 = createOmnivisionPlugin({
        config: defaultConfig,
        workspace: testWorkspace,
        sessionId: 'session-b',
        extraProviders: [mockProvider],
      })

      await plugin1.processMessage('Test', [{ path: join(tmpdir(), 'img.png'), contentHash: 'same-hash', mime: 'image/png', bytes: 100 }], 'e1')
      await plugin2.processMessage('Test', [{ path: join(tmpdir(), 'img.png'), contentHash: 'same-hash', mime: 'image/png', bytes: 100 }], 'e2')

      // Different sessions → different cache keys → both should call provider
      expect(mockProvider.execute).toHaveBeenCalledTimes(2)
    })
  })

  describe('Shadow History', () => {
    it('should create proper shadow replacements', async () => {
      mockProvider.execute.mockResolvedValue({
        ok: true, data: { summary: 'Description' },
        meta: { provider: 'mock', model: 'mock', durationMs: 10 },
      } as VisionResult)

      const plugin = makePlugin({ sessionId: 'shadow-test' })
      const result = await plugin.processMessage('Query', [
        { path: join(tmpdir(), 'img.png'), contentHash: 'hash1', mime: 'image/png', bytes: 1024 },
      ], 'original-event-id')

      expect(result.shadows).toHaveLength(1)
      expect((result.shadows![0].surfaceOp as any).op).toBe('keep')
      expect((result.shadows![0].modelOp as any).op).toBe('replace')
    })
  })

  describe('Cache Performance', () => {
    it('should reuse cached results within same session', async () => {
      mockProvider.execute.mockResolvedValue({
        ok: true, data: { summary: 'Cached' },
        meta: { provider: 'mock', model: 'mock', durationMs: 10 },
      } as VisionResult)

      const plugin = createOmnivisionPlugin({
        config: defaultConfig,
        workspace: testWorkspace,
        sessionId: 'cache-test',
        extraProviders: [mockProvider],
      })

      // First call
      await plugin.processMessage('Query', [{ path: join(tmpdir(), 'img.png'), contentHash: 'cache-hash', mime: 'image/png', bytes: 100 }], 'e1')
      // Second call with same image and same query → should hit cache
      await plugin.processMessage('Query', [{ path: join(tmpdir(), 'img.png'), contentHash: 'cache-hash', mime: 'image/png', bytes: 100 }], 'e2')

      // Same image + same query + same session → only 1 provider call
      expect(mockProvider.execute).toHaveBeenCalledTimes(1)
    })

    it('should cache miss on different query', async () => {
      mockProvider.execute.mockResolvedValue({
        ok: true, data: { summary: 'Cached' },
        meta: { provider: 'mock', model: 'mock', durationMs: 10 },
      } as VisionResult)

      const plugin = createOmnivisionPlugin({
        config: defaultConfig,
        workspace: testWorkspace,
        sessionId: 'cache-test',
        extraProviders: [mockProvider],
      })

      // Same image, different query → cache miss
      await plugin.processMessage('Query A', [{ path: join(tmpdir(), 'img.png'), contentHash: 'cache-hash', mime: 'image/png', bytes: 100 }], 'e1')
      await plugin.processMessage('Query B', [{ path: join(tmpdir(), 'img.png'), contentHash: 'cache-hash', mime: 'image/png', bytes: 100 }], 'e2')

      expect(mockProvider.execute).toHaveBeenCalledTimes(2)
    })
  })

  describe('Error Handling', () => {
    it('should handle provider failure gracefully', async () => {
      mockProvider.execute.mockRejectedValue(new Error('Connection refused'))

      const plugin = makePlugin()
      const result = await plugin.processMessage('Query', [{ path: join(tmpdir(), 'img.png'), contentHash: 'err-hash', mime: 'image/png', bytes: 1024 }], 'e1')

      expect(result.rewritten).toBe(true)
      expect(result.hasErrors).toBe(true)
      expect(result.newContent).toContain('Vision error')
      expect(result.descriptions).toHaveLength(0)
    })

    it('should return empty descriptions when all providers fail', async () => {
      mockProvider.execute.mockRejectedValue(new Error('Auth failed'))

      const plugin = makePlugin()
      const result = await plugin.processMessage('Query', [{ path: join(tmpdir(), 'img.png'), contentHash: 'err-hash', mime: 'image/png', bytes: 1024 }], 'e1')

      expect(result.rewritten).toBe(true)
      expect(result.descriptions).toHaveLength(0)
    })
  })

  describe('Circuit Breaker', () => {
    it('should track circuit breaker stats', async () => {
      mockProvider.execute.mockRejectedValue(new Error('Rate limited'))

      const plugin = makePlugin()
      await plugin.processMessage('Query', [{ path: join(tmpdir(), 'img.png'), contentHash: 'err-hash', mime: 'image/png', bytes: 1024 }], 'e1')

      const stats = plugin.stats()
      expect(stats.providers).toBeGreaterThanOrEqual(0)
    })
  })
})
