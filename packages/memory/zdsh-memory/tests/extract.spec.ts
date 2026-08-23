/**
 * Extraction rule branches: decision cues and their successor sentences,
 * corrective preferences (including the bare-别 compound guard), assistant
 * fact sentences with fenced-code statistics, and the bounded-text contract.
 */

import { describe, expect, it } from 'vitest'
import {
  DECISION_CUE,
  MAX_PREFERENCES_PER_MESSAGE,
  MEMORY_TEXT_MAX_CHARS,
  PREFERENCE_CUE,
  codeBlockStats,
  extractAssistantCandidate,
  extractUserCandidates,
  splitSentences,
  truncateMemoryText,
} from '../src/extract.ts'

describe('sentence splitting and truncation', () => {
  it('splits on Chinese/Latin strong terminators and drops empties', () => {
    expect(splitSentences('就用 pnpm。安装吧！好吗？\n第二行；第三行')).toEqual([
      '就用 pnpm',
      '安装吧',
      '好吗',
      '第二行',
      '第三行',
    ])
  })

  it('keeps Latin dots intact inside names and versions', () => {
    expect(splitSentences('Node.js 22 与 vite.config.ts 保持原样')).toEqual([
      'Node.js 22 与 vite.config.ts 保持原样',
    ])
  })

  it('normalizes whitespace runs and passes short texts through', () => {
    expect(truncateMemoryText('  就用   pnpm\t作为\n包管理器 ')).toBe('就用 pnpm 作为 包管理器')
  })

  it(`truncates to ${MEMORY_TEXT_MAX_CHARS} characters including the ellipsis`, () => {
    const truncated = truncateMemoryText('长'.repeat(500))
    expect(truncated.length).toBe(MEMORY_TEXT_MAX_CHARS)
    expect(truncated.endsWith('…')).toBe(true)
  })

  it('exposes the documented cue vocabularies', () => {
    expect(DECISION_CUE.test('我们决定迁移')).toBe(true)
    expect(PREFERENCE_CUE.test('不要再用 var')).toBe(true)
  })
})

describe('decision extraction', () => {
  it('captures the matched sentence plus its successor', () => {
    const [entry] = extractUserCandidates('项目太乱了。我们决定迁移到 pnpm。后续所有安装都走 workspace 协议。')
    expect(entry?.kind).toBe('decision')
    expect(entry?.text).toContain('决定迁移到 pnpm')
    expect(entry?.text).toContain('后续所有安装都走 workspace 协议')
  })

  it('captures a lone decision sentence without a successor', () => {
    const [entry] = extractUserCandidates('就用了')
    expect(entry?.kind).toBe('decision')
    expect(entry?.text).toBe('就用了')
  })

  it.each([
    ['选定了 vitest 作为测试框架', true],
    ['以后都走这个流程', true],
    ['今天天气不错', false],
  ])('applies the cue vocabulary (%j → %j)', (text, expected) => {
    const decisions = extractUserCandidates(text).filter(entry => entry.kind === 'decision')
    expect(decisions.length > 0).toBe(expected)
  })
})

describe('preference extraction', () => {
  it('captures 不要 corrective feedback', () => {
    const entries = extractUserCandidates('不要在提交前跳过测试')
    expect(entries.some(entry => entry.kind === 'preference' && entry.text.includes('不要'))).toBe(true)
  })

  it('captures 改成 corrective feedback', () => {
    const entries = extractUserCandidates('日志格式改成 JSON')
    expect(entries.some(entry => entry.kind === 'preference' && entry.text.includes('改成'))).toBe(true)
  })

  it('captures a bare 别 used as a negation', () => {
    const entries = extractUserCandidates('先别提交，跑一遍完整测试')
    expect(entries.some(entry => entry.kind === 'preference' && entry.text.includes('别提交'))).toBe(true)
  })

  it('ignores 别 inside compound words', () => {
    const entries = extractUserCandidates('特别提醒一下这个库的版本级别问题，分别记录下来作对比')
    expect(entries.filter(entry => entry.kind === 'preference')).toEqual([])
  })

  it(`caps preferences at ${MAX_PREFERENCES_PER_MESSAGE} per message`, () => {
    const text = ['不要用 any', '别再手写解析', '改成统一工具', '不要重复自己'].join('。')
    const preferences = extractUserCandidates(text).filter(entry => entry.kind === 'preference')
    expect(preferences.length).toBe(MAX_PREFERENCES_PER_MESSAGE)
  })
})

describe('combined extraction', () => {
  it('extracts a decision and a preference from the same message', () => {
    const entries = extractUserCandidates('我决定用 monorepo。不要改动现有包名。')
    expect(entries.map(entry => entry.kind).sort()).toEqual(['decision', 'preference'])
  })
})

describe('assistant fact extraction', () => {
  it('captures the first prose sentence of a plain reply', () => {
    const candidate = extractAssistantCandidate('构建已通过。此外还修复了两个警告。')
    expect(candidate?.kind).toBe('fact')
    expect(candidate?.text).toBe('构建已通过')
  })

  it('annotates code-block statistics with the dominant language', () => {
    const reply = '结论如下。\n```ts\nconst a = 1\n```\n```ts\nconst b = 2\n```\n```js\nconst c = 3\n```'
    const candidate = extractAssistantCandidate(reply)
    expect(candidate?.text).toContain('结论如下')
    expect(candidate?.text).toContain('含3个ts 代码块')
  })

  it('treats unnamed fences as blocks without a dominant language', () => {
    expect(codeBlockStats('```\n一\n```\n```\n二\n```')).toEqual({ blocks: 2 })
  })

  it('breaks lexicographic ties between equally frequent languages', () => {
    expect(codeBlockStats('```zig\nx\n```\n```asm\ny\n```')).toEqual({ blocks: 2, dominantLanguage: 'asm' })
  })

  it('counts an unterminated trailing fence as a block', () => {
    expect(codeBlockStats('开头\n```py\nprint(1)').blocks).toBe(1)
  })

  it('does not count closing fences as new blocks', () => {
    expect(codeBlockStats('```js\nx\n```\n结尾文字').blocks).toBe(1)
  })

  it('falls back to stats alone when the reply is code-only', () => {
    const candidate = extractAssistantCandidate('```go\nfmt.Println("hi")\n```')
    expect(candidate?.kind).toBe('fact')
    expect(candidate?.text).toBe('（含1个go 代码块）')
  })

  it('returns undefined for an empty reply', () => {
    expect(extractAssistantCandidate('   \n  ')).toBeUndefined()
  })
})
