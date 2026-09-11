import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FsWatcherManager } from '../src/fs-watch.ts'
import type { WatchFactory } from '../src/fs-watch.ts'

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

describe('fs watcher manager', () => {
  it('debounces and coalesces events per root into one frame', async () => {
    const emitters = new Map<string, (kind: 'modify', filename: string | null) => void>()
    const factory: WatchFactory = (root, onChange) => {
      emitters.set(root, onChange)
      return { close() {} }
    }
    const manager = new FsWatcherManager({ debounceMs: 10, watchFactory: factory })
    const frames: Array<{ domain: string; changes?: Array<{ path: string }> }> = []
    manager.subscribe(frame => frames.push(frame))

    const dispose = manager.addRoots(['C:/ws-a'.replace(/\//g, '\\'), 'C:\\ws-b'].map(root => root)) // platform-agnostic enough for the map keys below
    void dispose

    const rootA = [...emitters.keys()].find(key => key.includes('ws-a')) ?? ''
    emitters.get(rootA)?.('modify', 'x.txt')
    emitters.get(rootA)?.('modify', 'y.txt') // same window: coalesced into one batch
    await sleep(40)
    expect(frames).toHaveLength(1)
    expect(frames[0]?.domain).toBe('fs')
    expect(frames[0]?.changes?.map(change => change.path)).toEqual([
      join(rootA, 'x.txt'),
      join(rootA, 'y.txt'),
    ])
  })

  it('closes an idle root after the last subscriber leaves', async () => {
    let closes = 0
    const factory: WatchFactory = () => ({ close: () => (closes += 1) })
    const manager = new FsWatcherManager({ debounceMs: 5, idleCloseMs: 15, watchFactory: factory })
    const unsubscribe = manager.subscribe(() => {})
    const dispose = manager.addRoots(['C:\\idle'])
    expect(manager.activeRootCount()).toBe(1)
    dispose()
    unsubscribe()
    await sleep(60)
    expect(closes).toBe(1)
    expect(manager.activeRootCount()).toBe(0)
  })

  it('evicts the oldest root beyond the LRU cap', () => {
    const closed: string[] = []
    const factory: WatchFactory = root => ({
      close: () => closed.push(root),
    })
    const manager = new FsWatcherManager({ debounceMs: 5, maxRoots: 2, watchFactory: factory })
    manager.subscribe(() => {})
    const d1 = manager.addRoots(['C:\\one'])
    manager.addRoots(['C:\\two'])
    manager.addRoots(['C:\\three'])
    expect(manager.activeRootCount()).toBe(2)
    expect(closed).toEqual(['C:\\one'])
    d1()
  })

  it('marks a root degraded when the underlying watch throws', async () => {
    const factory: WatchFactory = (root) => {
      if (root.includes('bad')) throw new Error('recursive unsupported')
      return { close() {} }
    }
    const manager = new FsWatcherManager({ debounceMs: 5, watchFactory: factory })
    manager.subscribe(() => {})
    const dispose = manager.addRoots(['C:\\good', 'C:\\is-bad-root'])
    await sleep(5)
    expect(manager.isDegraded('C:\\is-bad-root')).toBe(true)
    expect(manager.isDegraded('C:\\good')).toBe(false)
    dispose()
  })

  it('keeps a live root open while any subscriber remains', async () => {
    let closes = 0
    const factory: WatchFactory = () => ({ close: () => (closes += 1) })
    const manager = new FsWatcherManager({ debounceMs: 5, idleCloseMs: 10, watchFactory: factory })
    manager.subscribe(() => {})
    const first = manager.addRoots(['C:\\shared'])
    const second = manager.addRoots(['C:\\shared'])
    first()
    await sleep(30)
    expect(closes).toBe(0) // second still holds it past the idle window
    second()
    await sleep(40)
    expect(closes).toBe(1)
  })
})
