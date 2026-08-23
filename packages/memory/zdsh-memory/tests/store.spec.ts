/**
 * Store behavior: daily-shard rotation, atomic persistence and reload,
 * global FIFO capacity eviction (including shard-file deletion), dedupe
 * `hits`, `forget`, fail-soft parsing of damaged shards, and the
 * DSH_BRANCH_HOME root resolution convention.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DSH_BRANCH_HOME_ENV, MEMORY_DIR_NAME, resolveBranchHome, resolveMemoryRoot } from '../src/home.ts'
import { DEFAULT_MEMORY_CAPACITY, MemoryStore, dateKeyOf, evictToCapacity } from '../src/store.ts'
import type { MemoryCandidate, MemoryEntry, MemoryShardFile } from '../src/types.ts'

const DAY_A = Date.UTC(2026, 7, 21, 12, 0, 0)
const DAY_B = Date.UTC(2026, 7, 22, 12, 0, 0)

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'zdsh-memory-'))
  roots.push(root)
  return root
}

function candidate(text: string, kind: MemoryCandidate['kind'] = 'decision'): MemoryCandidate {
  return { kind, text }
}

function entry(text: string, createdAt: number, id = `mem_${text}`): MemoryEntry {
  return { id, kind: 'decision', text, sessionId: 'sess-1', createdAt, hits: 1 }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('shard layout', () => {
  it('derives UTC day keys from timestamps', () => {
    expect(dateKeyOf(DAY_A)).toBe('2026-08-21')
    expect(dateKeyOf(DAY_B)).toBe('2026-08-22')
    // One millisecond before UTC midnight rolls to the previous day.
    expect(dateKeyOf(Date.UTC(2026, 7, 22) - 1)).toBe('2026-08-21')
  })

  it('persists a record as a versioned daily shard on disk', async () => {
    const root = join(tempRoot(), 'memory')
    const store = new MemoryStore(root)
    await store.record(candidate('就用 pnpm'), 'sess-1', DAY_A)
    const shardPath = join(root, '2026-08-21.json')
    expect(existsSync(shardPath)).toBe(true)
    const shard = JSON.parse(readFileSync(shardPath, 'utf8')) as MemoryShardFile
    expect(shard.version).toBe(1)
    expect(shard.date).toBe('2026-08-21')
    expect(shard.entries.length).toBe(1)
    expect(shard.entries[0]?.kind).toBe('decision')
  })

  it('rotates across days into one shard file per day', async () => {
    const root = tempRoot()
    const store = new MemoryStore(root)
    await store.record(candidate('周一的决定'), 'sess-1', DAY_A)
    await store.record(candidate('周二的偏好', 'preference'), 'sess-1', DAY_B)
    expect(existsSync(join(root, '2026-08-21.json'))).toBe(true)
    expect(existsSync(join(root, '2026-08-22.json'))).toBe(true)
    const listed = await store.list()
    expect(listed.map(entry => entry.kind)).toEqual(['decision', 'preference'])
  })

  it('lists entries oldest-first across shards', async () => {
    const store = new MemoryStore(tempRoot())
    await store.record(candidate('较晚'), 's', DAY_B)
    await store.record(candidate('较早'), 's', DAY_A)
    const listed = await store.list()
    expect(listed.map(entry => entry.createdAt)).toEqual([DAY_A, DAY_B])
  })

  it('reloads persisted shards into a fresh store instance', async () => {
    const root = tempRoot()
    const first = new MemoryStore(root)
    const recorded = await first.record(candidate('跨进程可见'), 'sess-9', DAY_A)
    const second = new MemoryStore(root)
    const listed = await second.list()
    expect(listed.length).toBe(1)
    expect(listed[0]?.id).toBe(recorded.id)
    expect(listed[0]?.sessionId).toBe('sess-9')
  })
})

describe('capacity and FIFO eviction', () => {
  it('evicts the oldest entries past the global cap', async () => {
    const store = new MemoryStore(tempRoot(), { capacity: 3 })
    for (const [index, day] of [DAY_A, DAY_A + 1_000, DAY_B, DAY_B + 1_000, DAY_B + 2_000].entries()) {
      await store.record(candidate(`条目${String(index)}`), 's', day)
    }
    const texts = (await store.list()).map(entry => entry.text)
    expect(texts).toEqual(['条目2', '条目3', '条目4'])
  })

  it('rewrites surviving shards after an eviction crosses days', async () => {
    const root = tempRoot()
    const store = new MemoryStore(root, { capacity: 2 })
    await store.record(candidate('A0'), 's', DAY_A)
    await store.record(candidate('A1'), 's', DAY_A + 1)
    await store.record(candidate('B0'), 's', DAY_B)
    const survivorShard = JSON.parse(readFileSync(join(root, '2026-08-21.json'), 'utf8')) as MemoryShardFile
    expect(survivorShard.entries.map(entry => entry.text)).toEqual(['A1'])
    expect((await store.list()).map(entry => entry.text)).toEqual(['A1', 'B0'])
  })

  it('deletes a shard file whose group emptied out entirely', async () => {
    const root = tempRoot()
    const store = new MemoryStore(root, { capacity: 1 })
    await store.record(candidate('只活一天的条目'), 's', DAY_A)
    expect(existsSync(join(root, '2026-08-21.json'))).toBe(true)
    await store.record(candidate('接棒的条目'), 's', DAY_B)
    expect(existsSync(join(root, '2026-08-21.json'))).toBe(false)
    expect(existsSync(join(root, '2026-08-22.json'))).toBe(true)
  })

  it('exposes the default capacity constant', () => {
    expect(DEFAULT_MEMORY_CAPACITY).toBe(500)
  })

  it('keeps every entry in evictToCapacity when under the cap', () => {
    const entries = [entry('a', 1), entry('b', 2)]
    expect(evictToCapacity(entries, 5)).toEqual({ kept: entries, evicted: [] })
  })

  it('evicts strictly oldest-first, tie-breaking by id', () => {
    const kept = [entry('a', 1, 'x2'), entry('b', 1, 'x3'), entry('c', 0, 'x1')]
    const result = evictToCapacity(kept, 2)
    expect(result.evicted.map(item => item.id)).toEqual(['x1'])
    expect(result.kept.map(item => item.id)).toEqual(['x2', 'x3'])
  })
})

describe('dedupe and forget', () => {
  it('increments hits instead of duplicating identical normalized text', async () => {
    const root = tempRoot()
    const store = new MemoryStore(root)
    const first = await store.record(candidate('就用 pnpm 作为包管理器'), 's1', DAY_A)
    const second = await store.record(candidate('就用   pnpm 作为包管理器 '), 's2', DAY_B)
    expect(second.id).toBe(first.id)
    expect(second.hits).toBe(2)
    expect(await store.list()).toHaveLength(1)
    const reloaded = await new MemoryStore(root).list()
    expect(reloaded[0]?.hits).toBe(2)
  })

  it('treats case-differing latin text as the same memory', async () => {
    const store = new MemoryStore(tempRoot())
    await store.record(candidate('Always use pnpm'), 's1', DAY_A)
    const again = await store.record(candidate('always USE pnpm'), 's1', DAY_A + 1)
    expect(again.hits).toBe(2)
  })

  it('forgets an existing id wherever its shard lives and reports misses as false', async () => {
    const root = tempRoot()
    const store = new MemoryStore(root)
    const recorded = await store.record(candidate('会被忘掉的'), 's1', DAY_A)
    expect(await store.forget('mem_missing')).toBe(false)
    expect(await store.forget(recorded.id)).toBe(true)
    expect(await store.list()).toEqual([])
    expect(existsSync(join(root, '2026-08-21.json'))).toBe(false)
  })

  it('forget survives reload: the removal is durable', async () => {
    const root = tempRoot()
    const writer = new MemoryStore(root)
    const recorded = await writer.record(candidate('先写后删'), 's1', DAY_A)
    const reader = new MemoryStore(root)
    expect(await reader.forget(recorded.id)).toBe(true)
    expect(await new MemoryStore(root).list()).toEqual([])
  })
})

describe('fail-soft shard parsing', () => {
  it('ignores malformed JSON shards on load', async () => {
    const root = tempRoot()
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, '2026-08-21.json'), '{not json', 'utf8')
    writeFileSync(join(root, 'not-a-shard.json'), '{"version":1}', 'utf8')
    const store = new MemoryStore(root)
    expect(await store.list()).toEqual([])
    expect(store.cachedEntries()).toEqual([])
  })

  it('ignores shards with the wrong version or date stamp', async () => {
    const root = tempRoot()
    mkdirSync(root, { recursive: true })
    const good: MemoryShardFile = { version: 1, date: '2026-08-21', entries: [entry('有效', DAY_A)] }
    writeFileSync(join(root, '2026-08-21.json'), JSON.stringify(good), 'utf8')
    writeFileSync(join(root, '2026-08-22.json'), JSON.stringify({ ...good, version: 99 }), 'utf8')
    writeFileSync(join(root, '2026-08-23.json'), JSON.stringify({ ...good, date: '1999-01-01' }), 'utf8')
    writeFileSync(join(root, '2026-08-24.json'), JSON.stringify({ version: 1, date: '2026-08-24', entries: [{ id: 'bad' }] }), 'utf8')
    const listed = await new MemoryStore(root).list()
    expect(listed.map(entry => entry.text)).toEqual(['有效'])
  })
})

describe('branch-home resolution convention', () => {
  it('prefers an explicit storage root over everything else', () => {
    process.env[DSH_BRANCH_HOME_ENV] = join(tmpdir(), 'env-home')
    try {
      expect(resolveMemoryRoot('/explicit/root')).toBe(resolve('/explicit/root'))
      expect(resolveMemoryRoot('  /spaced/root  ')).toBe(resolve('  /spaced/root  '))
    } finally {
      Reflect.deleteProperty(process.env, DSH_BRANCH_HOME_ENV)
    }
  })

  it('resolves DSH_BRANCH_HOME ahead of the homedir default and appends /memory', () => {
    const branchHome = join(tmpdir(), 'branch-home')
    process.env[DSH_BRANCH_HOME_ENV] = branchHome
    try {
      expect(resolveBranchHome()).toBe(branchHome)
      expect(resolveMemoryRoot()).toBe(join(branchHome, MEMORY_DIR_NAME))
      expect(resolveMemoryRoot('  ')).toBe(join(branchHome, MEMORY_DIR_NAME))
    } finally {
      Reflect.deleteProperty(process.env, DSH_BRANCH_HOME_ENV)
    }
  })

  it('falls back to ~/.dsh-zdsh without any override', () => {
    Reflect.deleteProperty(process.env, DSH_BRANCH_HOME_ENV)
    const home = resolveBranchHome()
    expect(home.endsWith('.dsh-zdsh')).toBe(true)
    expect(resolveMemoryRoot()).toBe(join(home, MEMORY_DIR_NAME))
  })
})
