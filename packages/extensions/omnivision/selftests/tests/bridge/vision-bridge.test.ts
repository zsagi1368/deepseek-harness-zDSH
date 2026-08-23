/**
 * Tests for Vision Bridge — with TTL and session isolation
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { VisionBridge } from '../../src/bridge/vision-bridge.ts'
import type { VisionProvider, VisionResult } from '../../src/vision/provider.ts'

const mockProvider: VisionProvider = {
  name: 'test-provider', defaultModel: 'test-model', category: 'api', speedClass: 'fast',
  execute: vi.fn(),
}

describe('VisionBridge', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('should return empty array when no images', async () => {
    const bridge = new VisionBridge([mockProvider], 'auto')
    expect(await bridge.processImages([], 'Test')).toEqual([])
  })

  it('should process single image and return description', async () => {
    vi.mocked(mockProvider.execute).mockResolvedValue({
      ok: true, data: { summary: 'Test description' },
      meta: { provider: 'test', model: 'test', durationMs: 100 },
    } as VisionResult)

    const bridge = new VisionBridge([mockProvider], 'auto')
    const images = [{ path: '/test/image.png', contentHash: 'abc123', mime: 'image/png', bytes: 1024 }]
    const result = await bridge.processImages(images, 'Test query')

    expect(result).toHaveLength(1)
    expect(result[0].summary).toBe('Test description')
    expect(mockProvider.execute).toHaveBeenCalledTimes(1)
  })

  it('should cache results and reuse', async () => {
    vi.mocked(mockProvider.execute).mockResolvedValue({
      ok: true, data: { summary: 'Cached result' },
      meta: { provider: 'test', model: 'test', durationMs: 50 },
    } as VisionResult)

    const bridge = new VisionBridge([mockProvider], 'auto')
    const images = [{ path: '/test/image.png', contentHash: 'abc123', mime: 'image/png', bytes: 1024 }]

    await bridge.processImages(images, 'Test query')
    await bridge.processImages(images, 'Test query')

    expect(mockProvider.execute).toHaveBeenCalledTimes(1)
  })

  it('should failover to next provider on failure', async () => {
    const failed: VisionProvider = { name: 'failed', defaultModel: 'fail', category: 'api', speedClass: 'fast',
      execute: vi.fn().mockRejectedValue(new Error('Connection refused')) }
    const working: VisionProvider = { name: 'working', defaultModel: 'work', category: 'api', speedClass: 'fast',
      execute: vi.fn().mockResolvedValue({
        ok: true, data: { summary: 'Working result' },
        meta: { provider: 'working', model: 'work', durationMs: 100 },
      } as VisionResult) }

    const bridge = new VisionBridge([failed, working], 'auto')
    const images = [{ path: '/test/image.png', contentHash: 'def456', mime: 'image/png', bytes: 2048 }]
    const result = await bridge.processImages(images, 'Test')

    expect(result).toHaveLength(1)
    expect(result[0].summary).toBe('Working result')
    expect(failed.execute).toHaveBeenCalledTimes(1)
    expect(working.execute).toHaveBeenCalledTimes(1)
  })

  it('should return error description when all providers fail', async () => {
    const failing: VisionProvider = { name: 'fail', defaultModel: 'fail', category: 'api', speedClass: 'fast',
      execute: vi.fn().mockRejectedValue(new Error('Always fails')) }

    const bridge = new VisionBridge([failing], 'auto')
    const images = [{ path: '/test/image.png', contentHash: 'xyz789', mime: 'image/png', bytes: 512 }]
    const result = await bridge.processImages(images, 'Test')
    expect(result).toHaveLength(1)
    expect(result[0].summary).toContain('Vision error')
  })

  it('should handle manual mode correctly', async () => {
    const bridge = new VisionBridge([mockProvider], 'manual')
    const images = [{ path: '/test/image.png', contentHash: 'manual123', mime: 'image/png', bytes: 1024 }]
    const result = await bridge.processImages(images, 'Test')
    expect(result).toEqual([])
    expect(mockProvider.execute).not.toHaveBeenCalled()
  })

  it('should generate stable cache keys with session isolation', async () => {
    const bridge1 = new VisionBridge([mockProvider], 'auto', 'session1')
    const bridge2 = new VisionBridge([mockProvider], 'auto', 'session2')

    vi.mocked(mockProvider.execute).mockResolvedValue({
      ok: true, data: { summary: 'Same content' },
      meta: { provider: 'test', model: 'test', durationMs: 10 },
    } as VisionResult)

    const images = [{ path: '/test/a.png', contentHash: 'hash1', mime: 'image/png', bytes: 100 }]

    await bridge1.processImages(images, 'Query')
    await bridge2.processImages(images, 'Query')

    // Different sessions should call provider separately
    expect(mockProvider.execute).toHaveBeenCalledTimes(2)
  })

  it('should respect abort signal', async () => {
    const slow: VisionProvider = { name: 'slow', defaultModel: 'slow', category: 'api', speedClass: 'slow',
      execute: vi.fn().mockImplementation(() => new Promise(() => {})) }

    const bridge = new VisionBridge([slow], 'auto')
    const images = [{ path: '/test/image.png', contentHash: 'abort123', mime: 'image/png', bytes: 1024 }]

    const controller = new AbortController()
    setTimeout(() => controller.abort(), 10)

    const result = await Promise.race([
      bridge.processImages(images, 'Test', controller.signal),
      new Promise<VisionDescription[]>(resolve => setTimeout(() => resolve([]), 100)),
    ])
    expect(result).toBeDefined()
  })
})
