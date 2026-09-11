/** Task-center wire vocabulary. Ledger is host-authoritative; clients render
 * snapshots and mutate through RPC, refreshed by `tasks` SSE frames that
 * carry only the new revision (pull-on-signal model). */

export type TaskStatus = 'todo' | 'doing' | 'done'

/** One ledger task row. */
export interface TaskItem {
  id: string
  title: string
  status: TaskStatus
  createdAt: number
  updatedAt: number
}

/** Full ledger snapshot: revision plus task rows. */
export interface TaskSnapshot {
  revision: number
  tasks: TaskItem[]
}

/** RPC payload for creating a task. */
export interface TaskCreateRequest {
  title: string
  status?: TaskStatus
}

/** RPC payload for updating a task. */
export interface TaskUpdateRequest {
  id: string
  status?: TaskStatus
  title?: string
}

/** RPC payload for deleting a task. */
export interface TaskDeleteRequest {
  id: string
}

/** Canonical task statuses in display order. */
export const TASK_STATUSES: readonly TaskStatus[] = ['todo', 'doing', 'done']
