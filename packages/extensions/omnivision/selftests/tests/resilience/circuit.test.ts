/**
 * Tests for Circuit Breaker
 */
import { describe, it, expect, vi } from 'vitest'
import { VisionCircuitBreaker } from '../../../src/resilience/circuit.ts'
import type { VisionFailure } from '../../../src/config/types.ts'

describe('VisionCircuitBreaker', () => {
  it('should not block by default', () => {
    const cb = new VisionCircuitBreaker()
    expect(cb.isBlocked('provider1')).toBe(false)
  })

  it('should block after AUTH failure', () => {
    const cb = new VisionCircuitBreaker({ authTripTtlMs: 1000 })

    const failure: VisionFailure = {
      kind: 'AUTH',
      code: 'VISION_AUTH_FAILED',
      message: 'Unauthorized',
      retryable: false,
    }

    cb.record('provider1', failure)
    expect(cb.isBlocked('provider1')).toBe(true)
    expect(cb.getTimeUntilReady('provider1')).toBeGreaterThan(0)
  })

  it('should unblock after TTL expires', async () => {
    const cb = new VisionCircuitBreaker({ authTripTtlMs: 100 })

    const failure: VisionFailure = {
      kind: 'AUTH',
      code: 'VISION_AUTH_FAILED',
      message: 'Unauthorized',
      retryable: false,
    }

    cb.record('provider1', failure)
    expect(cb.isBlocked('provider1')).toBe(true)

    // Wait for TTL
    await new Promise(r => setTimeout(r, 150))

    expect(cb.isBlocked('provider1')).toBe(false)
  })

  it('should clear on success', () => {
    const cb = new VisionCircuitBreaker()

    cb.record('provider1', {
      kind: 'RATE_LIMIT',
      code: 'VISION_RATE_LIMITED',
      message: 'Too many requests',
      retryable: true,
    })

    expect(cb.isBlocked('provider1')).toBe(true)

    cb.record('provider1', 'success')
    expect(cb.isBlocked('provider1')).toBe(false)
  })

  it('should track stats', () => {
    const cb = new VisionCircuitBreaker({ authTripTtlMs: 10000 })

    cb.record('provider1', { kind: 'AUTH', code: 'E1', message: 'Err', retryable: false })
    cb.record('provider2', { kind: 'RATE_LIMIT', code: 'E2', message: 'Err', retryable: true })

    const stats = cb.stats()
    expect(stats.blocked).toContain('provider1')
    expect(stats.total).toBe(2)
  })

  it('should clear all states', () => {
    const cb = new VisionCircuitBreaker()

    cb.record('provider1', { kind: 'AUTH', code: 'E1', message: 'Err', retryable: false })
    cb.clear()

    expect(cb.isBlocked('provider1')).toBe(false)
    expect(cb.stats().total).toBe(0)
  })
})
