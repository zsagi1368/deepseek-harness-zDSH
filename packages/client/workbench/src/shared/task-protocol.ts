/** Task-center wire vocabulary. Ledger is host-authoritative; clients render
 * snapshots and mutate through RPC, refreshed by `tasks` SSE frames that
 * carry only the new revision (pull-on-signal model). */

export type TaskStatus = 'todo' | 'doing' | 'done'

export interface TaskItem {
  id: string
  title: string
  status: TaskStatus
  createdAt: number
  updatedAt: number
}

export interface TaskSnapshot {
  revision: number
  tasks: TaskItem[]
}

export interface TaskCreateRequest {
  title: string
  status?: TaskStatus
}

export interface TaskUpdateRequest {
  id: string
  status?: TaskStatus
  title?: string
}

export interface TaskDeleteRequest {
  id: string
}

export const TASK_STATUSES: readonly TaskStatus[] = ['todo', 'doing', 'done']
