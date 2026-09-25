/**
 * gen-config-catalog factory/ 负向豁免锁（F-V1-1 清偿，TC-B4-H1 面九）。
 *
 * 豁免面必须窄（卡面纪律）：packages/factory/* 纯清单/装配包无 src/index.ts
 * 出口不再判违例（P-8 Option 2 同法，政策源 DESIGN:261/主线 2026-09-15 裁定），
 * 而非 factory 成员的 entry 判违例语义原样保留（负对照：豁免面扩张必红）。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectConfigCatalog } from './gen-config-catalog.ts'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'config-catalog-factory-'))
  roots.push(root)
  return root
}

function write(root: string, rel: string, text: string): void {
  const target = join(root, rel)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, text, 'utf8')
}

/** One manifest-only package (no src/index.ts) under `packages/<group>/<name>`. */
function manifestOnlyPackage(root: string, group: string, name: string, pkg: string): void {
  write(root, join('packages', group, name, 'package.json'), JSON.stringify({ name: pkg, version: '1.0.0' }))
}

describe('collectConfigCatalog factory/ negative exemption (F-V1-1)', () => {
  it('exempts a packages/factory/* manifest-only package: no entry violation, not catalogued', () => {
    const root = fixture()
    // zdsh-factory-bundle 同形：纯清单/装配包，无 src/index.ts 构建出口。
    manifestOnlyPackage(root, 'factory', 'fake-bundle', '@fixtures/fake-factory-bundle')
    expect(() => collectConfigCatalog(root)).not.toThrow()
    expect(collectConfigCatalog(root).map(entry => entry.pkg)).not.toContain('@fixtures/fake-factory-bundle')
  })

  it('keeps the entry violation for a non-factory manifest-only package (exemption stays narrow)', () => {
    const root = fixture()
    // 负对照：同形包在 factory/ 之外必须照旧判违例——豁免面若扩张到目录前缀之外，本锁红。
    manifestOnlyPackage(root, 'plugins', 'real-pkg', '@fixtures/real-pkg')
    const expected = /@fixtures\/real-pkg: entry packages\/plugins\/real-pkg\/src\/index\.ts is missing or unreadable/
    expect(() => collectConfigCatalog(root)).toThrow(expected)
  })

  it('reports only the non-factory violation when both shapes coexist', () => {
    const root = fixture()
    manifestOnlyPackage(root, 'factory', 'fake-bundle', '@fixtures/fake-factory-bundle')
    manifestOnlyPackage(root, 'host', 'other-pkg', '@fixtures/other-pkg')
    expect(() => collectConfigCatalog(root)).toThrow(/1 violation/)
    expect(() => collectConfigCatalog(root)).toThrow(/@fixtures\/other-pkg/)
    // 豁免窄面判别：factory 件绝不入违例清单（抛出的聚合消息不含其名）。
    expect(() => collectConfigCatalog(root)).not.toThrow(/fake-factory-bundle/)
  })
})
