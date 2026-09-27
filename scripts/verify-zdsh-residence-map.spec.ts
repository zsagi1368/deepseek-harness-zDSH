import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  checkResidenceMap,
  collectLocalPackageNameIndex,
  containsTreeDirectory,
  parseCatFileBatchNameIndex,
  parseManifestName,
  ZDSH_RESIDENCE_MAP,
  type UpstreamTreeFacts,
  type ZdshResidenceEntry,
} from './verify-zdsh-residence-map.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixtureRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-zdsh-residence-'))
  roots.push(root)
  return root
}

/** A minimal two-entry map shaped like the real table, for hermetic checks. */
const TEST_MAP: readonly ZdshResidenceEntry[] = [
  {
    dir: 'packages/zdsh/dsh-compat',
    packageName: '@deepseek-ai/dsh-compat',
    formerPath: 'packages/compat/dsh-compat',
    officialCounterpart: 'test entry',
  },
  {
    dir: 'zdsh-factory',
    packageName: null,
    formerPath: null,
    officialCounterpart: 'test seed entry',
  },
]

function upstream(partial: Partial<UpstreamTreeFacts> = {}): UpstreamTreeFacts {
  return {
    ref: 'upstream/test',
    paths: ['packages/core/dsh-core/src/index.ts'],
    packageNames: new Map([['@deepseek-ai/dsh-core', 'packages/core/dsh-core/package.json']]),
    ...partial,
  }
}

describe('zDSH residence map table', () => {
  it('maps the five migrated packages plus the root seed directory', () => {
    const dirs = ZDSH_RESIDENCE_MAP.map(entry => entry.dir)
    expect(dirs).toEqual([
      'packages/zdsh/dsh-compat',
      'packages/zdsh/plugin-governance',
      'packages/zdsh/plugin-governance-host',
      'packages/zdsh/plugin-project-root',
      'packages/zdsh/factory-bundle',
      'zdsh-factory',
    ])
    expect(new Set(dirs).size).toBe(dirs.length)
  })

  it('keeps every package entry in the frozen @deepseek-ai/* namespace (N1) with a two-level zdsh residence', () => {
    for (const entry of ZDSH_RESIDENCE_MAP) {
      if (entry.packageName === null) {
        expect(entry.dir).toBe('zdsh-factory')
        continue
      }
      expect(entry.packageName.startsWith('@deepseek-ai/')).toBe(true)
      expect(entry.dir).toMatch(/^packages\/zdsh\/[^/]+$/)
      expect(entry.formerPath).not.toBeNull()
      expect(entry.officialCounterpart.length).toBeGreaterThan(0)
    }
  })
})

describe('containsTreeDirectory', () => {
  it('matches tracked files inside a directory but not sibling prefixes', () => {
    const paths = ['packages/zdsh-adjacent/file.ts', 'packages/zdsh/dsh-compat/src/index.ts']
    expect(containsTreeDirectory(paths, 'packages/zdsh/dsh-compat')).toBe(true)
    expect(containsTreeDirectory(paths, 'packages/zdsh')).toBe(true)
    expect(containsTreeDirectory(paths, 'packages/zdsh-adjacent')).toBe(true)
    expect(containsTreeDirectory(paths, 'packages/zdsh/dsh-compat/src/index.ts/extra')).toBe(false)
    expect(containsTreeDirectory([], 'packages/zdsh')).toBe(false)
  })
})

describe('checkResidenceMap', () => {
  it('reports no finding when upstream never touches a zDSH residence, name, or dependency', () => {
    expect(checkResidenceMap({
      map: TEST_MAP,
      upstream: upstream({
        packageNames: new Map([
          ['@deepseek-ai/dsh-core', 'packages/core/dsh-core/package.json'],
          ['@deepseek-ai/dsh-invariants', 'packages/runtime-diagnostics/invariants/package.json'],
        ]),
      }),
      localPackageNames: new Map([['@deepseek-ai/dsh-invariants', 'packages/runtime-diagnostics/invariants/package.json']]),
      dependencies: new Map([['@deepseek-ai/dsh-compat', ['@deepseek-ai/dsh-invariants']]]),
    })).toEqual([])
  })

  it('flags add/add path risk when upstream grows content under a zDSH residence', () => {
    const findings = checkResidenceMap({
      map: TEST_MAP,
      upstream: upstream({ paths: ['packages/zdsh/dsh-compat/README.md'] }),
      localPackageNames: new Map(),
      dependencies: new Map(),
    })
    expect(findings).toEqual([{
      kind: 'add-add-path',
      artifact: 'packages/zdsh/dsh-compat',
      detail: 'upstream upstream/test grew content under the zDSH residence path packages/zdsh/dsh-compat/',
    }])
  })

  it('flags the root seed directory as a residence path too', () => {
    const findings = checkResidenceMap({
      map: TEST_MAP,
      upstream: upstream({ paths: ['zdsh-factory/seed.json'] }),
      localPackageNames: new Map(),
      dependencies: new Map(),
    })
    expect(findings.map(finding => finding.kind)).toEqual(['add-add-path'])
    expect(findings[0]?.artifact).toBe('zdsh-factory')
  })

  it('flags a resurrected former path without confusing it with the current residence', () => {
    const findings = checkResidenceMap({
      map: TEST_MAP,
      upstream: upstream({ paths: ['packages/compat/dsh-compat/src/index.ts'] }),
      localPackageNames: new Map(),
      dependencies: new Map(),
    })
    expect(findings).toEqual([{
      kind: 'resurrected-former-path',
      artifact: 'packages/zdsh/dsh-compat',
      detail: 'upstream upstream/test recreated the former zDSH path packages/compat/dsh-compat/'
        + ' while the artifact now lives at packages/zdsh/dsh-compat',
    }])
  })

  it('flags the TD-1 name-squatting trigger when upstream declares a zDSH package name', () => {
    const findings = checkResidenceMap({
      map: TEST_MAP,
      upstream: upstream({
        packageNames: new Map([['@deepseek-ai/dsh-compat', 'packages/compat/dsh-compat/package.json']]),
      }),
      localPackageNames: new Map(),
      dependencies: new Map(),
    })
    expect(findings.map(finding => finding.kind)).toEqual(['add-add-name'])
    expect(findings[0]?.detail).toContain('TD-1')
  })

  it('flags a broken link when upstream deletes a workspace-supplied dependency', () => {
    const findings = checkResidenceMap({
      map: TEST_MAP,
      upstream: upstream({ packageNames: new Map() }),
      localPackageNames: new Map([['@deepseek-ai/dsh-invariants', 'packages/runtime-diagnostics/invariants/package.json']]),
      dependencies: new Map([['@deepseek-ai/dsh-compat', ['@deepseek-ai/dsh-invariants']]]),
    })
    expect(findings).toEqual([{
      kind: 'broken-link',
      artifact: '@deepseek-ai/dsh-compat',
      detail: '@deepseek-ai/dsh-compat depends on @deepseek-ai/dsh-invariants, which the local workspace supplies'
        + ' but upstream upstream/test no longer declares',
    }])
  })

  it('never reports zDSH-internal or non-workspace dependency edges as broken links', () => {
    const findings = checkResidenceMap({
      map: TEST_MAP,
      upstream: upstream({ packageNames: new Map() }),
      // dsh-compat is a zDSH-owned name; dsh-webstack is git-pinned, not workspace-supplied.
      localPackageNames: new Map([['@deepseek-ai/dsh-compat', 'packages/zdsh/dsh-compat/package.json']]),
      dependencies: new Map([
        ['@deepseek-ai/dsh-compat', ['@deepseek-ai/dsh-compat', 'dsh-webstack', 'node:fs']],
      ]),
    })
    expect(findings).toEqual([])
  })

  it('defaults to the shipped residence map when no map is injected', () => {
    const findings = checkResidenceMap({
      upstream: upstream({ paths: ['packages/zdsh/factory-bundle/package.json'] }),
      localPackageNames: new Map(),
      dependencies: new Map(),
    })
    expect(findings.some(finding => finding.artifact === 'packages/zdsh/factory-bundle')).toBe(true)
  })
})

describe('parseCatFileBatchNameIndex', () => {
  it('pairs blob headers positionally with the request list and skips missing objects', () => {
    const first = '{"name": "@deepseek-ai/dsh-core"}'
    const second = '{"version": "1.0.0"}'
    // Real batch output echoes resolved object SHAs, not the input specs.
    const batch = [
      `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa blob ${String(Buffer.byteLength(first))}`,
      first,
      'upstream/test:packages/gone/pkg/package.json missing',
      `bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb blob ${String(Buffer.byteLength(second))}`,
      second,
      '',
    ].join('\n')
    expect(parseCatFileBatchNameIndex(Buffer.from(batch, 'utf8'), [
      'packages/core/dsh-core/package.json',
      'packages/gone/pkg/package.json',
      'vendor/tool/package.json',
    ])).toEqual(new Map([
      ['@deepseek-ai/dsh-core', 'packages/core/dsh-core/package.json'],
    ]))
  })

  it('consumes multibyte manifest content by byte size without drifting', () => {
    // The section sign and em dash are multibyte in UTF-8; a character-offset
    // parser would desync here (the real factory-bundle description case).
    const wide = '{"name": "@deepseek-ai/wide", "description": "§1.1 — ok"}'
    const next = '{"name": "@deepseek-ai/next"}'
    const batch = [
      `cccccccccccccccccccccccccccccccccccccccc blob ${String(Buffer.byteLength(wide))}`,
      wide,
      `dddddddddddddddddddddddddddddddddddddd blob ${String(Buffer.byteLength(next))}`,
      next,
      '',
    ].join('\n')
    expect(parseCatFileBatchNameIndex(Buffer.from(batch, 'utf8'), [
      'packages/wide/wide/package.json',
      'packages/next/next/package.json',
    ])).toEqual(new Map([
      ['@deepseek-ai/wide', 'packages/wide/wide/package.json'],
      ['@deepseek-ai/next', 'packages/next/next/package.json'],
    ]))
  })

  it('throws on a batch protocol desync instead of silently dropping names', () => {
    expect(() => parseCatFileBatchNameIndex(Buffer.from('garbage header line\n', 'utf8'), [
      'packages/core/dsh-core/package.json',
    ])).toThrow(/protocol desync/)
  })

  it('returns an empty index for empty batch output', () => {
    expect(parseCatFileBatchNameIndex(Buffer.alloc(0), []).size).toBe(0)
  })
})

describe('parseManifestName', () => {
  it('accepts a top-level string name only', () => {
    expect(parseManifestName('{"name": "@deepseek-ai/x"}')).toBe('@deepseek-ai/x')
    expect(parseManifestName('{"name": ""}')).toBeNull()
    expect(parseManifestName('{"name": 42}')).toBeNull()
    expect(parseManifestName('{}')).toBeNull()
    expect(parseManifestName('not json')).toBeNull()
  })
})

describe('collectLocalPackageNameIndex', () => {
  it('indexes two-level packages and one-level vendor manifests from a fixture root', () => {
    const root = fixtureRoot()
    const pkgDir = join(root, 'packages', 'zdsh', 'fake-piece')
    const vendorDir = join(root, 'vendor', 'fake-vendor')
    mkdirSync(pkgDir, { recursive: true })
    mkdirSync(vendorDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), '{"name": "@deepseek-ai/fake-piece"}')
    writeFileSync(join(vendorDir, 'package.json'), '{"name": "@deepseek-ai/fake-vendor"}')
    // A three-level manifest is outside the workspace globs and must be ignored.
    const nestedDir = join(root, 'packages', 'zdsh', 'fake-piece', 'inner')
    mkdirSync(nestedDir, { recursive: true })
    writeFileSync(join(nestedDir, 'package.json'), '{"name": "@deepseek-ai/nested"}')

    expect(collectLocalPackageNameIndex(root)).toEqual(new Map([
      ['@deepseek-ai/fake-piece', 'packages/zdsh/fake-piece/package.json'],
      ['@deepseek-ai/fake-vendor', 'vendor/fake-vendor/package.json'],
    ]))
  })
})
