/**
 * #176 pin: the launcher's first-impression banner names the product, version,
 * and booted profile, states the first-start expectation up front (bilingual),
 * and reaches only interactive terminals — a piped stderr, and therefore every
 * machine-consumed surface, sees nothing at all.
 */

import { describe, expect, it } from 'vitest'
import { printStartupBanner, shouldPrintStartupBanner, startupBannerLine } from '../src/startup-banner.ts'
import type { BannerStream } from '../src/startup-banner.ts'

describe('startupBannerLine', () => {
  it('names the product, version, and booted profile', () => {
    const line = startupBannerLine('0.1.0-rc.6', 'web')
    expect(line.startsWith('dsh 0.1.0-rc.6')).toBe(true)
    expect(line).toContain('booting profile web')
  })

  it('warns bilingually that the first start may take minutes', () => {
    const line = startupBannerLine('1.0.0', 'headless')
    expect(line).toContain('first start may take several minutes')
    expect(line).toContain('下载依赖')
    expect(line).toContain('数分钟')
  })
})

describe('shouldPrintStartupBanner', () => {
  it('prints only on an interactive terminal', () => {
    const sink = (): BannerStream => ({ isTTY: true, write: () => {} })
    expect(shouldPrintStartupBanner(sink())).toBe(true)
    expect(shouldPrintStartupBanner({ write: () => {} })).toBe(false)
    expect(shouldPrintStartupBanner({ isTTY: false, write: () => {} })).toBe(false)
  })
})

describe('printStartupBanner', () => {
  it('writes exactly one newline-terminated line to a terminal', () => {
    const chunks: string[] = []
    printStartupBanner('9.9.9', 'web', { isTTY: true, write: chunk => void chunks.push(chunk) })
    expect(chunks).toEqual([`${startupBannerLine('9.9.9', 'web')}\n`])
  })

  it('writes nothing when stderr is piped or captured', () => {
    const chunks: string[] = []
    printStartupBanner('9.9.9', 'web', { write: chunk => void chunks.push(chunk) })
    expect(chunks).toEqual([])
  })
})
