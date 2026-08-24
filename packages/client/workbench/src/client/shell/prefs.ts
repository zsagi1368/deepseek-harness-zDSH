/**
 * Workbench user preferences (shell-level): distinct from per-layout state —
 * these are cross-scope behavior switches. Persisted under one localStorage
 * key with strict validation and safe defaults; storage failures degrade to
 * in-memory like the layout store.
 */
export interface WorkbenchPrefs {
  /** Start with the dock collapsed on load. */
  startCollapsed: boolean
  /** Register the Ctrl/Cmd+Shift+P palette hotkey. */
  paletteHotkey: boolean
}

export const PREFS_DEFAULT: WorkbenchPrefs = {
  startCollapsed: false,
  paletteHotkey: true,
}

const PREFS_STORAGE_KEY = 'zdsh.workbench.prefs'

function isPrefs(value: unknown): value is WorkbenchPrefs {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.startCollapsed === 'boolean' && typeof candidate.paletteHotkey === 'boolean'
}

export function loadPrefs(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined,
): WorkbenchPrefs {
  if (storage === undefined) return { ...PREFS_DEFAULT }
  try {
    const raw = storage.getItem(PREFS_STORAGE_KEY)
    if (raw === null) return { ...PREFS_DEFAULT }
    const parsed: unknown = JSON.parse(raw)
    if (!isPrefs(parsed)) {
      storage.removeItem(PREFS_STORAGE_KEY)
      return { ...PREFS_DEFAULT }
    }
    return parsed
  } catch {
    return { ...PREFS_DEFAULT }
  }
}

export function savePrefs(
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined,
  prefs: WorkbenchPrefs,
): void {
  if (storage === undefined) return
  try {
    storage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // In-memory only; same posture as the layout store.
  }
}
