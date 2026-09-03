import { useCallback, useEffect, useState } from 'react'
import type { ApiClient } from '../../api.ts'
import { useWorkbenchT } from '../../shell/context.ts'
import type { TaskSnapshot, TaskStatus } from '../../../shared/task-protocol.ts'
import { TASK_STATUSES } from '../../../shared/task-protocol.ts'

const COLUMN_KEYS = { todo: 'columnTodo', doing: 'columnInProgress', done: 'columnDone' } as const satisfies Record<TaskStatus, import('../../locales.ts').WorkbenchKey>

/**
 * The task center panel: a three-column kanban over the host-authoritative
 * ledger. Mutations are RPCs; the SSE `tasks` frame only signals "revision
 * changed", and the panel pulls the new snapshot.
 */
export function TasksPanel(props: { api: ApiClient }): React.ReactNode {
  const { api } = props
  const t = useWorkbenchT()
  const [snapshot, setSnapshot] = useState<TaskSnapshot | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setSnapshot(await api.call('tasks.list', {}))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [api])

  useEffect(() => {
    void refresh()
    // Revision-signal subscription: pull-on-signal, never trust pushed state.
    const source = new EventSource('/workbench/events?roots=[]')
    source.onmessage = (event) => {
      try {
        const frame = JSON.parse(String(event.data)) as { domain?: string }
        if (frame.domain === 'tasks') void refresh()
      } catch {
        // ignore malformed frames
      }
    }
    return () => {
      source.close()
    }
  }, [refresh])

  async function mutate(method: string, payload: unknown): Promise<void> {
    try {
      setSnapshot(await api.call(method, payload))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function add(): Promise<void> {
    if (draft.trim() === '') return
    await mutate('tasks.create', { title: draft.trim(), status: 'todo' })
    setDraft('')
  }

  async function move(id: string, current: TaskStatus, direction: -1 | 1): Promise<void> {
    const index = TASK_STATUSES.indexOf(current)
    const next = TASK_STATUSES[index + direction]
    if (next === undefined) return
    await mutate('tasks.update', { id, status: next })
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
        <input
          style={{ flex: 1, minWidth: 0 }}
          placeholder={t('newTaskPlaceholder')}
          value={draft}
          onChange={(event) =>{  setDraft(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void add()
          }}
        />
        <button className="zdsh-wb-tab" onClick={() => void add()}>＋</button>
      </div>
      {error !== null ? <div className="zdsh-wb-orphan">{error}</div> : null}
      <div style={{ display: 'flex', gap: 6 }}>
        {TASK_STATUSES.map(status => (
          <div key={status} style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: 12, opacity: 0.8, marginBottom: 4 }}>
              {t(COLUMN_KEYS[status])} · {snapshot?.tasks.filter(task => task.status === status).length ?? 0}
            </div>
            {(snapshot?.tasks ?? []).filter(task => task.status === status).map(task => (
              <div key={task.id} className="zdsh-wb-menuitem" style={{ border: '1px solid var(--zdsh-wb-border)', borderRadius: 6, marginBottom: 4, padding: '4px 6px' }}>
                <div style={{ wordBreak: 'break-all', marginBottom: 2 }}>{task.title}</div>
                <div style={{ display: 'flex', gap: 2 }}>
                  <button className="zdsh-wb-iconbtn" style={{ fontSize: 10 }} title="←" onClick={() => void move(task.id, status, -1)}>←</button>
                  <button className="zdsh-wb-iconbtn" style={{ fontSize: 10 }} title="→" onClick={() => void move(task.id, status, 1)}>→</button>
                  <span style={{ flex: 1 }} />
                  <button className="zdsh-wb-iconbtn" style={{ fontSize: 10 }} title={t('deleteTask')} onClick={() => void mutate('tasks.delete', { id: task.id })}>✕</button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
