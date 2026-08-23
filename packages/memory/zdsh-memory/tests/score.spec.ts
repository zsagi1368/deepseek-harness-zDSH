/**
 * Keyword-overlap scoring: the token vocabulary (Latin words + CJK bigrams),
 * Top-K selection with tie-breaks, and section rendering (including the empty
 * contract that keeps irrelevant days invisible).
 */

import { describe, expect, it } from 'vitest'
import {
  KEYWORD_SCAN_MESSAGES,
  MEMORY_SECTION_NAME,
  MEMORY_SECTION_ORDER,
  renderMemorySection,
  selectTopK,
  tokenize,
} from '../src/score.ts'
import type { MemoryEntry } from '../src/types.ts'

function entry(text: string, overrides: Partial<MemoryEntry> = {}): MemoryEntry {
  return { id: `mem_${text}`, kind: 'decision', text, sessionId: 's', createdAt: 1_000, hits: 1, ...overrides }
}

describe('tokenize', () => {
  it('lowercases latin/digit words and drops one-character tokens', () => {
    expect(tokenize('Use Pnpm and Vite v7 a I')).toEqual(new Set(['use', 'pnpm', 'and', 'vite', 'v7']))
  })

  it('produces adjacent CJK bigrams over each run', () => {
    expect(tokenize('记忆注入')).toEqual(new Set(['记忆', '忆注', '注入']))
  })

  it('keeps a lone CJK character as its own token', () => {
    expect(tokenize('好')).toEqual(new Set(['好']))
  })

  it('combines both vocabularies for mixed text', () => {
    const tokens = tokenize('用 vitest 跑测试')
    expect(tokens.has('vitest')).toBe(true)
    expect(tokens.has('跑测')).toBe(true)
    expect(tokens.has('测试')).toBe(true)
  })
})

describe('selectTopK', () => {
  const keywords = tokenize('pnpm 迁移 测试')

  it('ranks higher overlap first and excludes zero-overlap entries', () => {
    const scored = selectTopK([
      entry('无关紧要的天气记录'),
      entry('决定迁移到 pnpm'),
      entry('测试流程改成先跑 lint'),
    ], keywords, 8)
    expect(scored.length).toBe(2)
    expect(scored[0]?.entry.text).toContain('迁移')
    expect(scored[0]?.score).toBeGreaterThanOrEqual(scored[1]?.score ?? 0)
  })

  it('caps results at k; non-positive k selects nothing', () => {
    const entries = [entry('pnpm A'), entry('pnpm B'), entry('pnpm C')]
    expect(selectTopK(entries, keywords, 2)).toHaveLength(2)
    expect(selectTopK(entries, keywords, 0)).toEqual([])
  })

  it('breaks score ties by newer createdAt, then smaller id', () => {
    const tied = [
      entry('旧的 pnpm 决定', { createdAt: 100, id: 'mem_old' }),
      entry('新的 pnpm 决定', { createdAt: 200, id: 'mem_new' }),
    ]
    expect(selectTopK(tied, keywords, 1)[0]?.entry.id).toBe('mem_new')
    const sameTime = [
      entry('bbb pnpm', { createdAt: 100, id: 'mem_bbb' }),
      entry('aaa pnpm', { createdAt: 100, id: 'mem_aaa' }),
    ]
    expect(selectTopK(sameTime, keywords, 1)[0]?.entry.id).toBe('mem_aaa')
  })
})

describe('renderMemorySection', () => {
  it('renders nothing when nothing is selected', () => {
    expect(renderMemorySection([])).toBe('')
  })

  it('renders labeled bullets with the recalled-xN suffix only past one hit', () => {
    const rendered = renderMemorySection([
      { score: 3, entry: entry('就用 pnpm；后续都走 workspace', { kind: 'decision', hits: 2 }) },
      { score: 1, entry: entry('不要跳过测试', { kind: 'preference' }) },
    ])
    expect(rendered.startsWith('Memories from earlier sessions that look relevant to the current task:')).toBe(true)
    expect(rendered).toContain('- [decision] 就用 pnpm；后续都走 workspace (recalled x2)')
    expect(rendered).toContain('- [preference] 不要跳过测试')
    expect(rendered.includes('recalled x1')).toBe(false)
  })

  it('labels fact entries as conclusions', () => {
    const rendered = renderMemorySection([{ score: 1, entry: entry('构建已通过（含2个ts 代码块）', { kind: 'fact' }) }])
    expect(rendered).toContain('- [conclusion] 构建已通过（含2个ts 代码块）')
  })

  it('exposes the registered section identity', () => {
    expect(MEMORY_SECTION_NAME).toBe('agent:memory')
    expect(MEMORY_SECTION_ORDER).toBe(20)
    expect(KEYWORD_SCAN_MESSAGES).toBeGreaterThan(0)
  })
})
