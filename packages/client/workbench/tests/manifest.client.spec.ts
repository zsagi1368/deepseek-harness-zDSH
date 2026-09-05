/**
 * Two-way manifest consistency: package.json and the compiled-in protocol
 * constants must agree on name and version. A drift here ships a plugin whose
 * loader row and self-reported version disagree — the failure mode this spec
 * exists to make loud. (The standalone dsh.plugin.json / cordis.patch.yml pair
 * from the upstream Workbench distribution does not exist in the monorepo:
 * bundle wiring is owned by packages/bundle/web-app.)
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { WORKBENCH_PACKAGE_NAME, WORKBENCH_VERSION } from '../src/shared/protocol.ts'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

function readJson(relative: string): Record<string, unknown> {
  return JSON.parse(readFileSync(new URL(relative, `file://${repoRoot.replace(/\\/g, '/')}`), 'utf8')) as Record<string, unknown>
}

describe('manifest consistency', () => {
  const pkg = readJson('package.json')

  it('keeps the compiled-in protocol constant on the package version', () => {
    expect(WORKBENCH_VERSION).toBe(pkg.version)
  })

  it('uses the same package name everywhere', () => {
    expect(pkg.name).toBe(WORKBENCH_PACKAGE_NAME)
  })

  it('declares the client face the loader mounts', () => {
    const exportsMap = pkg.exports as Record<string, { default?: string }> | undefined
    expect(exportsMap?.['.']?.default).toBe('./lib/index.js')
    expect(exportsMap?.['./client']?.default).toBe('./lib/client.js')
    const dsh = pkg.dsh as { client?: { platform?: string; inject?: string[] } } | undefined
    expect(dsh?.client?.platform).toBe('web')
    expect(Array.isArray(dsh?.client?.inject)).toBe(true)
  })
})
