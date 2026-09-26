/** Task center registration. */
import { createApiClient } from '../../api.ts'
import type { WorkbenchRegistryApi } from '../../registry.ts'
import { TasksPanel } from './TasksPanel.tsx'

export function registerTasksFeature(registry: WorkbenchRegistryApi): () => void {
  const api = createApiClient()
  return registry.registerPanel({
    id: 'tasks:board',
    titleKey: 'tasksTitle',
    order: 30,
    component: () => <TasksPanel api={api} />,
  })
}
