/** Browser panel registration. */
import type { WorkbenchRegistryApi } from '../../registry.ts'
import { BrowseView } from './BrowseView.tsx'

export function registerBrowseFeature(registry: WorkbenchRegistryApi): () => void {
  return registry.registerPanel({
    id: 'browse:main',
    titleKey: 'browseTitle',
    order: 50,
    component: () => <BrowseView />,
  })
}
