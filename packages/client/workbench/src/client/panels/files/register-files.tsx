/**
 * The files feature: explorer + file view panels registered through the same
 * public api third-party code uses. Owns the shared selected-file store the
 * two panels coordinate through.
 */
import { useSyncExternalStore } from 'react'
import type { WorkbenchRegistryApi } from '../../registry.ts'
import { useWorkbenchT } from '../../shell/context.ts'
import { createApiClient } from '../../api.ts'
import { getWorkspaceRoot, setWorkspaceRoot } from '../../shell/workspace-root.ts'
import { Explorer } from './Explorer.tsx'
import { ExplorerModel } from './explorer-model.ts'
import { FileView } from './FileView.tsx'

/** Tiny observable for the file the view panel should render. */
class SelectedFile {
  private listeners = new Set<() => void>()
  private snapshot: string | null = null

  get(): string | null {
    return this.snapshot
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  set(path: string | null): void {
    if (this.snapshot === path) return
    this.snapshot = path
    for (const listener of this.listeners) listener()
  }
}

export function registerFilesFeature(registry: WorkbenchRegistryApi): () => void {
  const api = createApiClient()
  const model = new ExplorerModel(api)
  const selected = new SelectedFile()

  // Restore the last workspace root so reopening the dock lands where the
  // user left off; storage failures degrade to a blank root.
  try {
    const lastRoot = getWorkspaceRoot()
    if (lastRoot !== '') {
      void model.openRoot(lastRoot)
    }
  } catch {
    // Privacy-mode storage: start blank.
  }

  const disposers = [
    registry.registerPanel({
      id: 'files:explorer',
      titleKey: 'filesTitle',
      order: 10,
      component: ({ openPanel }) => <Explorer model={model} onOpenFile={(path) => {
        selected.set(path)
        openPanel('files:view')
      }} />,
    }),
    registry.registerPanel({
      id: 'files:view',
      titleKey: 'filesViewGroup',
      order: 90,
      component: function FileViewPanel() {
        const t = useWorkbenchT()
        const path = useSyncExternalStore(selected.subscribe, () => selected.get())
        if (path === null) return <div className="zdsh-wb-empty">{t('filesPickFromPanel')}</div>
        return <FileView api={api} path={path} />
      },
    }),
  ]

  // Persist root changes for next boot.
  model.subscribe(() => {
    setWorkspaceRoot(model.root)
  })

  return () => {
    for (const dispose of disposers) dispose()
  }
}
