/**
 * DOM attachment for the dock shell. Self-mounting keeps the plugin
 * independent of any host-specific layout slot: it works identically on the
 * fork and on stock DSH, and teardown removes every node it created.
 */
import { createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { WorkbenchRegistryApi } from '../registry.ts'
import type { WorkbenchTranslate } from './context.ts'
import { fallbackTranslate, WorkbenchLocaleContext } from './context.ts'
import { DockRoot } from './DockRoot.tsx'
import { PALETTE_TOGGLE_EVENT } from './events.ts'
import { LayoutStore } from './layout-store.ts'
import { loadPrefs } from './prefs.ts'
import { DOCK_CONTAINER_ID, WORKBENCH_STYLE_ID, WORKBENCH_STYLES } from './styles.ts'

export interface MountedDock {
  store: LayoutStore
  /** Re-apply preference-driven behavior (currently the palette hotkey). */
  applyPrefs(prefs: import('./prefs.ts').WorkbenchPrefs): void
  dispose(): void
}

/** Global hotkey (Ctrl/Cmd+Shift+P) → palette toggle event on window. */
function attachPaletteHotkey(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'p') {
      // The browser's own print dialog owns plain Ctrl+P; ours requires Shift.
      event.preventDefault()
      window.dispatchEvent(new Event(PALETTE_TOGGLE_EVENT))
    }
  }
  window.addEventListener('keydown', onKeyDown)
  return () => {
    window.removeEventListener('keydown', onKeyDown)
  }
}

export function mountDock(
  registry: WorkbenchRegistryApi,
  options: {
    /** Active-locale translator bound by the plugin body; feeds the shell context. */
    translate?: WorkbenchTranslate
    onPrefsChange?: (prefs: import('./prefs.ts').WorkbenchPrefs) => void
  } = {},
): MountedDock {
  const disposers: Array<() => void> = []
  const prefs = loadPrefs(window.localStorage)

  let style = document.getElementById(WORKBENCH_STYLE_ID)
  if (style === null) {
    style = document.createElement('style')
    style.id = WORKBENCH_STYLE_ID
    style.textContent = WORKBENCH_STYLES
    document.head.appendChild(style)
    disposers.push(() => style?.remove())
  }

  const container = document.createElement('div')
  container.id = DOCK_CONTAINER_ID
  document.body.appendChild(container)
  disposers.push(() =>{  container.remove() })

  let activeHotkeyDisposer = prefs.paletteHotkey ? attachPaletteHotkey() : undefined
  if (activeHotkeyDisposer !== undefined) disposers.push(activeHotkeyDisposer)

  const store = new LayoutStore('global', window.localStorage)
  // Honor start-collapsed only when the user has no explicit collapse state
  // stored, so a manual expand survives reloads regardless of the pref.
  const storedLayout = store.getState().revision === 0 ? undefined : store.getState()
  if (prefs.startCollapsed && storedLayout === undefined) store.setCollapsed(true)

  const root = createRoot(container)
  root.render(
    createElement(
      WorkbenchLocaleContext.Provider,
      { value: options.translate ?? fallbackTranslate },
      createElement(DockRoot, {
        registry,
        store,
        prefs,
        ...(options.onPrefsChange === undefined ? {} : { onPrefsChange: options.onPrefsChange }),
      }),
    ),
  )

  return {
    store,
    applyPrefs(next) {
      const wantsHotkey = next.paletteHotkey
      if (wantsHotkey && activeHotkeyDisposer === undefined) {
        activeHotkeyDisposer = attachPaletteHotkey()
      } else if (!wantsHotkey && activeHotkeyDisposer !== undefined) {
        const index = disposers.indexOf(activeHotkeyDisposer)
        if (index !== -1) disposers.splice(index, 1)
        activeHotkeyDisposer()
        activeHotkeyDisposer = undefined
      }
    },
    dispose() {
      // React unmount must precede container removal so effects tear down.
      root.unmount()
      for (const dispose of disposers.reverse()) {
        try {
          dispose()
        } catch {
          // Teardown of one attachment must never block the rest.
        }
      }
    },
  }
}
