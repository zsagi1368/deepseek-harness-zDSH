import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CAPABILITY_SINCE_NODE,
  describeRuntimeSupport,
  REQUIRED_CAPABILITY,
  REQUIRED_NODE_ENGINES,
} from '../src/runtime-guard.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('describeRuntimeSupport', () => {
  it('reports support on a host whose AbortSignal.timeout is callable', () => {
    const support = describeRuntimeSupport('v22.19.0')
    expect(support.ok).toBe(true)
    expect(support.detail).toContain(REQUIRED_CAPABILITY)
    expect(support.detail).toContain('v22.19.0')
    expect(support.detail).not.toContain('missing')
  })

  it('refuses with the bilingual explanation when the AbortSignal namespace is absent', () => {
    vi.stubGlobal('AbortSignal', undefined)
    const support = describeRuntimeSupport('v16.20.2')

    expect(support.ok).toBe(false)
    expect(support.detail).toContain(`missing the required capability ${REQUIRED_CAPABILITY}`)
    expect(support.detail).toContain(`缺少必需能力 ${REQUIRED_CAPABILITY}`)
    expect(support.detail).toContain(REQUIRED_NODE_ENGINES)
    expect(support.detail).toContain(CAPABILITY_SINCE_NODE)
    expect(support.detail).toContain('process.version=v16.20.2')
  })

  it('refuses when AbortSignal exists but lacks the timeout member (embedded shim)', () => {
    vi.stubGlobal('AbortSignal', {})
    const support = describeRuntimeSupport('v18.0.0-embedded')

    expect(support.ok).toBe(false)
    expect(support.detail).toContain('process.version=v18.0.0-embedded')
    expect(support.detail).toContain('Please upgrade Node and retry')
  })

  it('refuses when timeout exists but is not callable (boundary)', () => {
    vi.stubGlobal('AbortSignal', { timeout: 42 })
    const support = describeRuntimeSupport('v20.1.0')

    expect(support.ok).toBe(false)
    expect(support.detail).toContain(`缺少必需能力 ${REQUIRED_CAPABILITY}`)
  })

  it('cites the live process.version when no explicit version is passed', () => {
    const support = describeRuntimeSupport()
    expect(support.ok).toBe(true)
    expect(support.detail).toContain(process.version)
  })
})
