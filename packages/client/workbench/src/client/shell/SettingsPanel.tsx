import { useState } from 'react'
import type { WorkbenchPrefs } from './prefs.ts'

/**
 * Shell settings panel, opened from the dock's gear button. Self-contained
 * by design: the official settings-page card slot is a fork-specific
 * enhancement deferred to the branch-integration phase, so this panel works
 * identically on stock DSH.
 */
export function SettingsPanel(props: {
  prefs: WorkbenchPrefs
  onChange: (next: WorkbenchPrefs) => void
  onClose: () => void
}): React.ReactNode {
  const { prefs, onChange, onClose } = props
  const [error, setError] = useState<string | null>(null)
  const set = (patch: Partial<WorkbenchPrefs>): void => {
    try {
      onChange({ ...prefs, ...patch })
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="zdsh-wb-plusmenu" style={{ top: 36, right: 6, left: 'auto', minWidth: 240 }} role="dialog" aria-label="workbench settings">
      <div style={{ padding: '6px 10px', fontWeight: 600 }}>工作台设置</div>
      <label className="zdsh-wb-menuitem" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={prefs.startCollapsed}
          onChange={(event) =>{  set({ startCollapsed: event.target.checked }) }}
        />
        启动时折叠侧栏
      </label>
      <label className="zdsh-wb-menuitem" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={prefs.paletteHotkey}
          onChange={(event) =>{  set({ paletteHotkey: event.target.checked }) }}
        />
        启用 Ctrl/Cmd+Shift+P 热键
      </label>
      {error !== null ? <div className="zdsh-wb-orphan">{error}</div> : null}
      <button className="zdsh-wb-menuitem" onClick={onClose}>完成</button>
    </div>
  )
}
