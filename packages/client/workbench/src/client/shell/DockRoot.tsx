import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { RegisteredPanel, WorkbenchRegistryApi } from '../registry.ts'
import { PALETTE_TOGGLE_EVENT, SET_COLLAPSED_EVENT } from './events.ts'
import type { LayoutStore } from './layout-store.ts'
import type { WorkbenchPrefs } from './prefs.ts'
import { SettingsPanel } from './SettingsPanel.tsx'

/**
 * Dock shell: right-edge panel with a tab bar, `+` menu, body area, and the
 * command-palette trigger. Rendering is registry-driven only — built-in
 * features and third-party registrations are indistinguishable here.
 *
 * A registered panel may contribute a component; panels without one render
 * the placeholder body (which also covers orphan tabs whose provider is not
 * currently loaded).
 */

function useLayout(store: LayoutStore): ReturnType<LayoutStore['getState']> {
  return useSyncExternalStore(
    listener => store.subscribe(listener),
    () => store.getState(),
  )
}

function useRegistryValue<T>(registry: WorkbenchRegistryApi, read: () => T): T {
  const subscribe = useMemo(
    () => (listener: () => void) => registry.subscribe(listener),
    [registry],
  )
  return useSyncExternalStore(subscribe, read)
}

/** Window event the host page can dispatch to toggle the palette (global hotkey). */
export { PALETTE_TOGGLE_EVENT } from './events.ts'

function PlusMenu(props: {
  panels: readonly RegisteredPanel[]
  onOpen: (id: string) => void
  onClose: () => void
}): React.ReactNode {
  const { panels, onOpen, onClose } = props
  const ref = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    const dismiss = (event: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) onClose()
    }
    document.addEventListener('mousedown', dismiss)
    return () => {
      document.removeEventListener('mousedown', dismiss)
    }
  }, [onClose])
  const openIds = new Set(panels.map(panel => panel.id))
  return (
    <div className="zdsh-wb-plusmenu" ref={ref} role="menu">
      {panels.length === 0 ? <button className="zdsh-wb-menuitem" disabled>（暂无可用面板）</button> : null}
      {panels.map(panel => (
        <button
          key={panel.id}
          role="menuitem"
          className="zdsh-wb-menuitem"
          disabled={openIds.has(panel.id)}
          onClick={() => {
            onOpen(panel.id)
            onClose()
          }}
        >
          {panel.title}
        </button>
      ))}
    </div>
  )
}

function CommandPalette(props: {
  commands: Array<{ id: string; title: string; run(): void }>
  onClose: () => void
}): React.ReactNode {
  const { commands, onClose } = props
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return commands
    return commands.filter(command => command.title.toLowerCase().includes(needle) || command.id.toLowerCase().includes(needle))
  }, [commands, query])

  useEffect(() => {
    setSelected(0)
  }, [query])

  const runAt = (index: number): void => {
    const command = filtered[index]
    if (command === undefined) return
    onClose()
    command.run()
  }

  return (
    <div
      className="zdsh-wb-palette-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose()
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          setSelected(index => Math.min(filtered.length - 1, index + 1))
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          setSelected(index => Math.max(0, index - 1))
        }
        if (event.key === 'Enter') runAt(selected)
      }}
    >
      <div className="zdsh-wb-palette">
        <input
          autoFocus
          placeholder="输入命令名…（Enter 执行，Esc 关闭）"
          value={query}
          onChange={(event) =>{  setQuery(event.target.value) }}
          aria-label="workbench command palette"
        />
        <ul role="listbox">
          {filtered.length === 0 ? <li className="zdsh-wb-orphan">没有匹配的命令</li> : null}
          {filtered.map((command, index) => (
            <li key={command.id}>
              <button
                className="zdsh-wb-menuitem"
                style={index === selected ? { background: 'var(--zdsh-wb-hover)' } : undefined}
                onMouseEnter={() =>{  setSelected(index) }}
                onClick={() =>{  runAt(index) }}
              >
                {command.title}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

export function DockRoot(props: {
  registry: WorkbenchRegistryApi
  store: LayoutStore
  prefs: WorkbenchPrefs
  onPrefsChange?: (prefs: WorkbenchPrefs) => void
}): React.ReactNode {
  const { registry, store, prefs, onPrefsChange } = props
  const layout = useLayout(store)
  const panels = useRegistryValue(registry, () => registry.getPanels())
  const commands = useRegistryValue(registry, () => registry.getCommands())

  // Reconcile stored tabs against live registrations whenever either side changes.
  useEffect(() => {
    store.syncRegistrations(registry.getPanels())
    return registry.subscribe(() =>{  store.syncRegistrations(registry.getPanels()) })
  }, [registry, store])

  const [plusOpen, setPlusOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  useEffect(() => {
    const toggle = (): void =>{  setPaletteOpen(open => !open) }
    const collapse = (event: Event): void => {
      const detail = (event as CustomEvent<boolean>).detail
      if (typeof detail === 'boolean') store.setCollapsed(detail)
    }
    window.addEventListener(PALETTE_TOGGLE_EVENT, toggle)
    window.addEventListener(SET_COLLAPSED_EVENT, collapse)
    return () => {
      window.removeEventListener(PALETTE_TOGGLE_EVENT, toggle)
      window.removeEventListener(SET_COLLAPSED_EVENT, collapse)
    }
  }, [store])

  const byId = useMemo(() => new Map(panels.map(panel => [panel.id, panel])), [panels])
  const activeId = layout.activeId
  const activeTab = layout.tabs.find(tab => tab.id === activeId) ?? null

  const palette = paletteOpen ? <CommandPalette commands={[...commands]} onClose={() =>{  setPaletteOpen(false) }} /> : null

  if (layout.collapsed) {
    return (
      <>
        <div className="zdsh-wb-collapsed" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
          <button
            className="zdsh-wb-iconbtn"
            title="展开工作台"
            aria-label="expand workbench"
            onClick={() =>{  store.setCollapsed(false) }}
          >
            ◀
          </button>
        </div>
        {palette}
      </>
    )
  }

  return (
    <>
      <div className="zdsh-wb-rail">
        {layout.tabs.map((tab) => {
          const panel = byId.get(tab.id)
          const label = tab.orphan ? `${tab.id}（提供者未加载）` : panel?.title ?? tab.id
          return (
            <span key={tab.id} style={{ display: 'inline-flex', alignItems: 'center' }}>
              <button
                className="zdsh-wb-tab"
                aria-selected={tab.id === activeId}
                title={label}
                onClick={() =>{  store.activate(tab.id) }}
              >
                {tab.orphan ? '?' : label}
              </button>
              <button
                className="zdsh-wb-iconbtn"
                style={{ padding: '3px 5px', opacity: 0.55 }}
                aria-label={`close ${label}`}
                onClick={() =>{  store.closeTab(tab.id) }}
              >
                ×
              </button>
            </span>
          )
        })}
        <span className="zdsh-wb-spacer" />
        <button className="zdsh-wb-iconbtn" title="打开面板（+）" onClick={() =>{  setPlusOpen(open => !open) }}>＋</button>
        <button className="zdsh-wb-iconbtn" title="命令面板（Ctrl/Cmd+Shift+P）" onClick={() =>{  setPaletteOpen(true) }}>⌘</button>
        {onPrefsChange !== undefined ? (
          <button className="zdsh-wb-iconbtn" title="工作台设置" onClick={() =>{  setSettingsOpen(open => !open) }}>⚙</button>
        ) : null}
        <button className="zdsh-wb-iconbtn" title="折叠工作台" onClick={() =>{  store.setCollapsed(true) }}>▶</button>
      </div>

      {settingsOpen && onPrefsChange !== undefined ? (
        <SettingsPanel
          prefs={prefs}
          onChange={onPrefsChange}
          onClose={() =>{  setSettingsOpen(false) }}
        />
      ) : null}

      {plusOpen ? (
        <PlusMenu
          panels={panels}
          onOpen={(id) =>{  store.openPanel(id) }}
          onClose={() =>{  setPlusOpen(false) }}
        />
      ) : null}

      <div className="zdsh-wb-body">
        {activeTab === null || activeId === null ? (
          <div className="zdsh-wb-empty">
            <div style={{ fontSize: 20 }}>▦</div>
            <div>zDSH 工作台</div>
            <div>通过右上 ＋ 打开面板</div>
          </div>
        ) : activeTab.orphan ? (
          <div className="zdsh-wb-orphan">
            面板「{activeId}」的提供者未加载。
            <button className="zdsh-wb-menuitem" onClick={() =>{  store.closeTab(activeId) }}>关闭此页签</button>
          </div>
        ) : (
          <PanelBody registry={registry} id={activeId} store={store} />
        )}
      </div>

      <div
        className="zdsh-wb-resizer"
        onPointerDown={(event) => {
          event.preventDefault()
          const startX = event.clientX
          const startWidth = store.getState().widthPercent
          const move = (moveEvent: PointerEvent): void => {
            const delta = moveEvent.clientX - startX
            const percent = startWidth - (delta / window.innerWidth) * 100
            store.setWidth(percent)
          }
          const up = (): void => {
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up)
        }}
      />

      {palette}
    </>
  )
}

function PanelBody(props: { registry: WorkbenchRegistryApi; id: string; store: LayoutStore }): React.ReactNode {
  const panel = props.registry.getPanels().find(candidate => candidate.id === props.id)
  const component = panel?.component
  if (component === undefined) {
    return (
      <div className="zdsh-wb-empty">
        <div>{props.id}</div>
        <div>该面板尚未提供内容组件。</div>
      </div>
    )
  }
  return component({
    visible: true,
    openPanel: (panelId: string) =>{  props.store.openPanel(panelId) },
    close: () =>{  props.store.closeTab(props.id) },
  })
}
