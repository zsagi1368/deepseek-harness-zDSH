import { useState } from 'react'
import type { WorkbenchPrefs } from './prefs.ts'
import { useWorkbenchT } from './context.ts'

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
  const t = useWorkbenchT()
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
    <div className="zdsh-wb-plusmenu" style={{ top: 36, right: 6, left: 'auto', minWidth: 240 }} role="dialog" aria-label={t('settingsAria')}>
      <div style={{ padding: '6px 10px', fontWeight: 600 }}>{t('settingsTitle')}</div>
      <label className="zdsh-wb-menuitem" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={prefs.startCollapsed}
          onChange={(event) =>{  set({ startCollapsed: event.target.checked }) }}
        />
        {t('prefStartCollapsed')}
      </label>
      <label className="zdsh-wb-menuitem" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={prefs.paletteHotkey}
          onChange={(event) =>{  set({ paletteHotkey: event.target.checked }) }}
        />
        {t('prefPaletteHotkey')}
      </label>
      {error !== null ? <div className="zdsh-wb-orphan">{error}</div> : null}
      <button className="zdsh-wb-menuitem" onClick={onClose}>{t('done')}</button>
    </div>
  )
}
