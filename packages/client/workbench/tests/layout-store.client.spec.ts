import { describe, expect, it, vi } from 'vitest'
import { LayoutStore, isLayout, reconcileTabs, resolveActive } from '../src/client/shell/layout-store.ts'

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
  const map = new Map<string, string>()
  return {
    getItem: key => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
    removeItem: (key) => {
      map.delete(key)
    },
  }
}

describe('workbench layout store', () => {
  it('opens panels, focuses them, and closes tabs', () => {
    const store = new LayoutStore('t', memoryStorage())
    store.openPanel('a:one')
    store.openPanel('b:two')
    expect(store.getState().tabs.map(tab => tab.id)).toEqual(['a:one', 'b:two'])
    expect(store.getState().activeId).toBe('b:two')
    // Re-opening an open panel only focuses it.
    store.openPanel('a:one')
    expect(store.getState().tabs).toHaveLength(2)
    expect(store.getState().activeId).toBe('a:one')
    store.closeTab('a:one')
    expect(store.getState().activeId).toBe('b:two')
    store.closeTab('b:two')
    expect(store.getState().activeId).toBeNull()
  })

  it('clamps width into the configured band and persists collapsed flag', () => {
    const storage = memoryStorage()
    const store = new LayoutStore('t', storage)
    store.setWidth(5)
    expect(store.getState().widthPercent).toBe(20)
    store.setWidth(120)
    expect(store.getState().widthPercent).toBe(80)
    store.setCollapsed(true)
    const reopened = new LayoutStore('t', storage)
    expect(reopened.getState().collapsed).toBe(true)
    expect(reopened.getState().widthPercent).toBe(80)
  })

  it('round-trips through real JSON storage and bumps revision per commit', () => {
    const storage = memoryStorage()
    const first = new LayoutStore('k', storage)
    const before = first.getState().revision
    first.openPanel('x:y')
    expect(first.getState().revision).toBeGreaterThan(before)
    const second = new LayoutStore('k', storage)
    expect(second.getState().tabs.map(tab => tab.id)).toEqual(['x:y'])
  })

  it('discards corrupt storage instead of partially trusting it', () => {
    const storage = memoryStorage()
    storage.setItem(LayoutStore.storageKey('bad'), '{"tabs":"nope"}')
    const store = new LayoutStore('bad', storage)
    expect(store.getState()).toEqual({
      tabs: [],
      activeId: null,
      widthPercent: 32,
      collapsed: false,
      revision: 0,
    })
  })

  it('survives storage failures (quota/privacy mode) without throwing', () => {
    const failing = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded')
      },
      removeItem: () => {},
    }
    const store = new LayoutStore('q', failing)
    expect(() =>{  store.openPanel('ok:panel') }).not.toThrow()
    expect(store.getState().tabs).toHaveLength(1)
  })

  it('reconciles orphans: unknown ids survive, returning providers revive', () => {
    const stored = [
      { id: 'live:a', orphan: false },
      { id: 'gone:x', orphan: false },
    ]
    const withAOnly = reconcileTabs(stored, [{ id: 'live:a', title: 'A', order: 10 }])
    expect(withAOnly.find(tab => tab.id === 'gone:x')?.orphan).toBe(true)
    expect(withAOnly.find(tab => tab.id === 'live:a')?.orphan).toBe(false)

    const revived = reconcileTabs(stored, [
      { id: 'live:a', title: 'A', order: 10 },
      { id: 'gone:x', title: 'X', order: 20 },
    ])
    expect(revived.every(tab => !tab.orphan)).toBe(true)
  })

  it('keeps an orphan active tab focused so the placeholder is visible', () => {
    const tabs = [
      { id: 'gone:x', orphan: true },
      { id: 'live:a', orphan: false },
    ]
    // The stored active id survives even as an orphan: the placeholder for
    // the tab you were reading IS the recovery surface.
    expect(resolveActive(tabs, 'gone:x')).toBe('gone:x')
    expect(resolveActive(tabs, 'live:a')).toBe('live:a')
    expect(resolveActive(tabs, 'missing:id')).toBe('live:a')
    // All-orphan list without a stored active still lands somewhere visible.
    expect(resolveActive([{ id: 'gone:y', orphan: true }], null)).toBe('gone:y')
    expect(resolveActive([], null)).toBeNull()
  })

  it('notifies subscribers on every committed change', () => {
    const store = new LayoutStore('n', memoryStorage())
    const listener = vi.fn()
    store.subscribe(listener)
    store.openPanel('n:a')
    store.activate('n:a') // same focus → still a state identity change? no: no-op
    store.setCollapsed(true)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('validates the stored shape strictly', () => {
    expect(isLayout({ tabs: [], activeId: null, widthPercent: 32, collapsed: false, revision: 0 })).toBe(true)
    expect(isLayout({ tabs: [{ id: 'a', orphan: false }], activeId: 'a', widthPercent: 40, collapsed: false, revision: 3 })).toBe(true)
    expect(isLayout(null)).toBe(false)
    expect(isLayout({})).toBe(false)
    expect(isLayout({ tabs: 'x', activeId: null, widthPercent: 32, collapsed: false, revision: 0 })).toBe(false)
    expect(isLayout({ tabs: [], activeId: 5, widthPercent: 32, collapsed: false, revision: 0 })).toBe(false)
  })
})
