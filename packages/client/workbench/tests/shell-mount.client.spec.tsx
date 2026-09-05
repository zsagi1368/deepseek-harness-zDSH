// @vitest-environment jsdom
/**
 * DOM-level verification of the dock shell without a browser: mounting
 * attaches exactly the nodes it owns, registered panels surface as tabs,
 * opening focuses them, and disposal removes everything.
 */
import { act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createWorkbenchRegistry } from '../src/client/registry.ts'
import { WORKBENCH_VERSION } from '../src/shared/protocol.ts'
import { mountDock } from '../src/client/shell/mount.tsx'
import { DOCK_CONTAINER_ID } from '../src/client/shell/styles.ts'

describe('dock shell mounting', () => {
  let storageBackup: Storage | undefined

  beforeEach(() => {
    // react-dom/test-utils act requires the act environment flag in React 18.
    ;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
    vi.spyOn(console, 'error').mockImplementation(() => {}) // silence act() deprecation noise
    storageBackup = window.localStorage
    // Fresh storage per test so layout/prefs never leak between cases.
    Object.defineProperty(window, 'localStorage', { value: window.sessionStorage, configurable: true })
    window.sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    Object.defineProperty(window, 'localStorage', { value: storageBackup ?? window.localStorage, configurable: true })
  })

  it('mounts the dock, surfaces an opened panel tab, and tears down cleanly', async () => {
    const registry = createWorkbenchRegistry(WORKBENCH_VERSION)
    const mounted = mountDock(registry)

    const container = document.getElementById(DOCK_CONTAINER_ID)
    expect(container).not.toBeNull()
    expect(document.getElementById('zdsh-workbench-styles')).not.toBeNull()

    registry.registerPanel({ id: 'demo:hello', title: '演示面板' })
    await act(async () => {
      mounted.store.openPanel('demo:hello')
    })

    const rail = container?.querySelector('.zdsh-wb-rail')
    expect(rail?.textContent).toContain('演示面板')
    expect(mounted.store.getState().activeId).toBe('demo:hello')

    await act(async () => {
      mounted.dispose()
    })
    expect(document.getElementById(DOCK_CONTAINER_ID)).toBeNull()
  })

  it('renders the orphan placeholder for tabs whose provider vanished', async () => {
    const registry = createWorkbenchRegistry(WORKBENCH_VERSION)
    window.localStorage.setItem(
      'zdsh.workbench.layout.global',
      JSON.stringify({
        tabs: [{ id: 'ghost:panel', orphan: false }],
        activeId: 'ghost:panel',
        widthPercent: 32,
        collapsed: false,
        revision: 4,
      }),
    )
    const mounted = mountDock(registry)
    await act(async () => {
      mounted.store.syncRegistrations([])
    })
    const body = document.querySelector('.zdsh-wb-body')
    expect(body?.textContent).toContain('提供者未加载')
    await act(async () => {
      mounted.dispose()
    })
  })
})
