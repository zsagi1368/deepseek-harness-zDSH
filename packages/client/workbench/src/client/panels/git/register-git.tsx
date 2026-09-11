/**
 * Git center registration: one panel, public-registry path like everything
 * else. The workspace root comes from the explorer's persisted choice so
 * both panels always agree on which repository is being inspected.
 */
import { createApiClient } from '../../api.ts'
import type { WorkbenchRegistryApi } from '../../registry.ts'
import { GitPanel } from './GitPanel.tsx'

export function registerGitFeature(registry: WorkbenchRegistryApi): () => void {
  const api = createApiClient()
  return registry.registerPanel({
    id: 'git:panel',
    titleKey: 'gitTitle',
    order: 20,
    component: function GitPanelHost() {
      return <GitPanel api={api} root={readRoot()} />
    },
  })
}

function readRoot(): string {
  try {
    const value = window.localStorage.getItem('zdsh.workbench.explorer.root')
    return typeof value === 'string' && value !== '' ? value : ''
  } catch {
    return ''
  }
}
