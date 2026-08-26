/** The launcher's user-first preset-roots merge (#403). */

import { describe, expect, it } from 'vitest'
import { mergedPresetRootsConfig } from '../src/profile-boot.ts'

function rootEntry(path: string): { path: string; trust: string } {
  return { path, trust: 'user' }
}

describe('mergedPresetRootsConfig', () => {
  it('keeps every user-configured root and appends the shipped system root', () => {
    const config = mergedPresetRootsConfig({
      default: 'standard',
      includeUserRoot: true,
      roots: [rootEntry('D:/project/.dsh/agent-presets')],
    })
    const roots = config.roots as Array<{ path: string; trust: string }>
    expect(roots).toHaveLength(2)
    expect(roots[0]).toEqual(rootEntry('D:/project/.dsh/agent-presets'))
    expect(roots.at(-1)?.trust).toBe('system')
    // The scalar fields ride along untouched.
    expect(config.default).toBe('standard')
    expect(config.includeUserRoot).toBe(true)
  })

  it('does not duplicate the shipped root when the user already lists it', () => {
    // Resolve the real shipped anchor through the module under test by
    // merging an empty config first and reading what the launcher added.
    const probe = (mergedPresetRootsConfig({}).roots as Array<{ path: string }>).at(-1)!
    const again = mergedPresetRootsConfig({ roots: [rootEntry(probe.path)] })
    expect((again.roots as unknown[])).toHaveLength(1)
  })

  it('falls back to the shipped-only list when roots is not an array', () => {
    const config = mergedPresetRootsConfig({ roots: 'oops' })
    const roots = config.roots as Array<{ trust: string }>
    expect(roots).toHaveLength(1)
    expect(roots[0]?.trust).toBe('system')
  })

  it('supplies a fresh list when no roots were configured at all', () => {
    const config = mergedPresetRootsConfig({ default: 'standard' })
    const roots = config.roots as Array<{ trust: string }>
    expect(roots).toHaveLength(1)
    expect(roots[0]?.trust).toBe('system')
  })
})
