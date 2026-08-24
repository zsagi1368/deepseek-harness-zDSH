/**
 * Layout persistence for the dock. One stored snapshot per scope key
 * (`global` until session-scoped wiring lands): which panels are open, the
 * active one, geometry, and collapsed state.
 *
 * Persistence rules this file owns:
 * - Stored panel types that no provider claims come back as orphan entries
 *   (kept, rendered as placeholders) instead of being silently dropped, so
 *   reloading after temporarily disabling a feature does not lose layout.
 * - Corrupt or foreign-shaped storage is discarded wholesale; defaults win.
 */
import type { RegisteredPanel } from '../registry.ts'

export interface LayoutTab {
  /** Panel id while registered; orphan entries keep their stored id. */
  id: string
  /** True when no provider currently claims this id. */
  orphan: boolean
}

export interface WorkbenchLayout {
  tabs: LayoutTab[]
  activeId: string | null
  widthPercent: number
  collapsed: boolean
  /** Monotonic write counter for cheap change detection. */
  revision: number
}

const WIDTH_MIN = 20
const WIDTH_MAX = 80
export const LAYOUT_DEFAULT: WorkbenchLayout = {
  tabs: [],
  activeId: null,
  widthPercent: 32,
  collapsed: false,
  revision: 0,
}

export function isLayout(value: unknown): value is WorkbenchLayout {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  if (!Array.isArray(candidate.tabs)) return false
  for (const tab of candidate.tabs) {
    if (typeof tab !== 'object' || tab === null) return false
    const entry = tab as Record<string, unknown>
    if (typeof entry.id !== 'string') return false
    if (typeof entry.orphan !== 'boolean') return false
  }
  if (candidate.activeId !== null && typeof candidate.activeId !== 'string') return false
  if (typeof candidate.widthPercent !== 'number' || !Number.isFinite(candidate.widthPercent)) return false
  if (typeof candidate.collapsed !== 'boolean') return false
  if (typeof candidate.revision !== 'number') return false
  return true
}

function clampWidth(widthPercent: number): number {
  if (!Number.isFinite(widthPercent)) return LAYOUT_DEFAULT.widthPercent
  return Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, widthPercent))
}

/** Order- and content-sensitive equality for tab lists. */
function sameTabs(a: readonly LayoutTab[], b: readonly LayoutTab[]): boolean {
  if (a.length !== b.length) return false
  return a.every((tab, index) => {
    const other = b[index]
    return other !== undefined && tab.id === other.id && tab.orphan === other.orphan
  })
}

/**
 * Reconcile stored tabs against the live registration snapshot:
 * known ids stay live entries, unknown ids survive as orphans, and an
 * orphan whose provider re-registers flips back to live automatically.
 */
export function reconcileTabs(stored: LayoutTab[], panels: readonly RegisteredPanel[]): LayoutTab[] {
  const claimed = new Set(panels.map(panel => panel.id))
  return stored.map(tab => ({ ...tab, orphan: !claimed.has(tab.id) }))
}

/**
 * Pick the active tab after reconciliation: keep the stored active id while
 * its tab still exists — even as an orphan, because "provider not loaded"
 * is exactly what the placeholder must show for the tab you were reading.
 * Otherwise prefer the first live tab, then any remaining tab, else null.
 */
export function resolveActive(tabs: readonly LayoutTab[], storedActiveId: string | null): string | null {
  if (storedActiveId !== null && tabs.some(tab => tab.id === storedActiveId)) return storedActiveId
  const firstLive = tabs.find(tab => !tab.orphan)
  return firstLive?.id ?? tabs[0]?.id ?? null
}

/** Storage-backed store. `storage` is injectable so tests run without localStorage. */
export class LayoutStore {
  private state: WorkbenchLayout
  private listeners = new Set<() => void>()

  constructor(
    private readonly scopeKey: string,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined,
  ) {
    this.state = this.read()
  }

  static storageKey(scopeKey: string): string {
    return `zdsh.workbench.layout.${scopeKey}`
  }

  private read(): WorkbenchLayout {
    if (this.storage === undefined) return { ...LAYOUT_DEFAULT }
    try {
      const raw = this.storage.getItem(LayoutStore.storageKey(this.scopeKey))
      if (raw === null) return { ...LAYOUT_DEFAULT }
      const parsed: unknown = JSON.parse(raw)
      if (!isLayout(parsed)) {
        // Foreign or corrupt shape: drop it rather than partially trusting it.
        this.storage.removeItem(LayoutStore.storageKey(this.scopeKey))
        return { ...LAYOUT_DEFAULT }
      }
      return parsed
    } catch {
      return { ...LAYOUT_DEFAULT }
    }
  }

  getState(): WorkbenchLayout {
    return this.state
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private commit(next: WorkbenchLayout): void {
    this.state = { ...next, revision: next.revision + 1 }
    if (this.storage !== undefined) {
      try {
        this.storage.setItem(LayoutStore.storageKey(this.scopeKey), JSON.stringify(this.state))
      } catch {
        // Quota or privacy-mode failures degrade to in-memory-only layout;
        // persistence loss must never break the shell.
      }
    }
    for (const listener of this.listeners) listener()
  }

  /** Re-run reconciliation against a fresh registration snapshot. */
  syncRegistrations(panels: readonly RegisteredPanel[]): void {
    const current = this.state
    const tabs = reconcileTabs(current.tabs, panels)
    const activeId = resolveActive(tabs, current.activeId)
    // Commit only on real change: this runs on every registration announce,
    // and an unconditional commit would notify right back into itself.
    if (
      tabs.length === 0 && current.tabs.length === 0 && activeId === current.activeId
    ) return
    if (sameTabs(tabs, current.tabs) && activeId === current.activeId) return
    this.commit({ ...current, tabs, activeId })
  }

  openPanel(panelId: string): void {
    const current = this.state
    if (current.tabs.some(tab => tab.id === panelId && !tab.orphan)) {
      this.commit({ ...current, activeId: panelId })
      return
    }
    const tabs = [...current.tabs.filter(tab => tab.id !== panelId), { id: panelId, orphan: false }]
    this.commit({ ...current, tabs, activeId: panelId })
  }

  closeTab(tabId: string): void {
    const current = this.state
    const index = current.tabs.findIndex(tab => tab.id === tabId)
    if (index === -1) return
    const tabs = current.tabs.filter(tab => tab.id !== tabId)
    const activeId = current.activeId === tabId ? resolveActive(tabs, null) : current.activeId
    this.commit({ ...current, tabs, activeId })
  }

  activate(tabId: string): void {
    if (this.state.activeId === tabId) return
    if (!this.state.tabs.some(tab => tab.id === tabId)) return
    this.commit({ ...this.state, activeId: tabId })
  }

  setWidth(percent: number): void {
    this.commit({ ...this.state, widthPercent: clampWidth(percent) })
  }

  setCollapsed(collapsed: boolean): void {
    this.commit({ ...this.state, collapsed })
  }
}
