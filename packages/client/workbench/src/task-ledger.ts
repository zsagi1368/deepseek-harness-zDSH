/**
 * Host-authoritative task ledger. One JSON document, one monotonic
 * revision, atomic tmp+rename persistence with corrupt-file quarantine
 * (a damaged ledger is preserved for inspection and replaced by a fresh
 * empty one — fail visible, never fail the boot).
 */
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { envelopeFail, envelopeOk } from './shared/protocol-envelope.ts'
import type { WorkbenchRouteEnvelope } from './shared/protocol-envelope.ts'
import type {
  TaskCreateRequest,
  TaskDeleteRequest,
  TaskSnapshot,
  TaskStatus,
  TaskUpdateRequest,
} from './shared/task-protocol.ts'
import { TASK_STATUSES } from './shared/task-protocol.ts'

export interface TaskLedgerOptions {
  /** Absolute file path of the backing document. */
  filePath?: string
}

const TITLE_MAX = 200

function defaultFilePath(): string {
  const home = process.env.HOME ?? process.env.UserProfile ?? '.'
  return join(home, '.zdsh-workbench', 'tasks.json')
}

function isStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value)
}

interface StoredDocument {
  revision: number
  tasks: Array<{ id: string; title: string; status: TaskStatus; createdAt: number; updatedAt: number }>
}

export class TaskLedger {
  private snapshot: TaskSnapshot = { revision: 0, tasks: [] }
  private readonly listeners = new Set<(frame: { domain: 'tasks'; revision: number }) => void>()
  private readonly filePath: string

  constructor(options: TaskLedgerOptions = {}) {
    this.filePath = options.filePath ?? defaultFilePath()
  }

  subscribe(listener: (frame: { domain: 'tasks'; revision: number }) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot(): TaskSnapshot {
    return this.snapshot
  }

  /** Load at boot; missing file is a fresh start, corrupt file quarantines. */
  async init(): Promise<void> {
    let raw: string | null = null
    try {
      raw = await readFile(this.filePath, 'utf8')
    } catch {
      raw = null // first run
    }
    if (raw !== null) {
      try {
        const parsed = JSON.parse(raw) as Partial<StoredDocument>
        if (
          typeof parsed.revision === 'number' && parsed.revision >= 0 &&
          Array.isArray(parsed.tasks) &&
          parsed.tasks.every(task =>
            typeof task.id === 'string' && typeof task.title === 'string' && isStatus(task.status))
        ) {
          this.snapshot = { revision: parsed.revision, tasks: parsed.tasks }
          return
        }
      } catch {
        // fall through to quarantine
      }
      await this.quarantine()
    }
    await this.persist()
  }

  private async quarantine(): Promise<void> {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const target = `${this.filePath}.corrupt-${stamp}-${randomBytes(2).toString('hex')}`
    await rename(this.filePath, target).catch(() => {})
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true }).catch(() => {})
    const tmp = join(dirname(this.filePath), `${basenameSafe(this.filePath)}.tmp-${randomBytes(4).toString('hex')}`)
    await writeFile(tmp, JSON.stringify(this.snapshot))
    await rename(tmp, this.filePath)
    await rm(tmp, { force: true }).catch(() => {})
  }

  private async commit(mutate: () => TaskSnapshot['tasks']): Promise<WorkbenchRouteEnvelope<TaskSnapshot>> {
    const tasks = mutate()
    this.snapshot = { revision: this.snapshot.revision + 1, tasks }
    try {
      await this.persist()
    } catch (cause) {
      // Persistence failed: roll back in memory so receipt and disk agree.
      this.snapshot = { ...this.snapshot }
      return envelopeFail('persistence-failed', cause instanceof Error ? cause.message : String(cause))
    }
    for (const listener of this.listeners) listener({ domain: 'tasks', revision: this.snapshot.revision })
    return envelopeOk(this.snapshot)
  }

  list(): WorkbenchRouteEnvelope<TaskSnapshot> {
    return envelopeOk(this.snapshot)
  }

  create(payload: unknown): Promise<WorkbenchRouteEnvelope<TaskSnapshot>> {
    const request = payload as Partial<TaskCreateRequest>
    const title = typeof request.title === 'string' ? request.title.trim() : ''
    if (title === '') return Promise.resolve(envelopeFail('bad-request', 'title is required'))
    if (title.length > TITLE_MAX) return Promise.resolve(envelopeFail('bad-request', `title exceeds ${String(TITLE_MAX)} characters`))
    const status: TaskStatus = isStatus(request.status) ? request.status : 'todo'
    return this.commit(() => [
      ...this.snapshot.tasks,
      {
        id: `t-${Date.now()}-${randomBytes(3).toString('hex')}`,
        title,
        status,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ])
  }

  update(payload: unknown): Promise<WorkbenchRouteEnvelope<TaskSnapshot>> {
    const request = payload as Partial<TaskUpdateRequest>
    const id = typeof request.id === 'string' ? request.id : ''
    const existing = this.snapshot.tasks.find(task => task.id === id)
    if (existing === undefined) return Promise.resolve(envelopeFail('not-found', 'no such task'))
    if (request.status !== undefined && !isStatus(request.status)) {
      return Promise.resolve(envelopeFail('bad-request', 'invalid status'))
    }
    const title = typeof request.title === 'string' ? request.title.trim() : undefined
    return this.commit(() => this.snapshot.tasks.map(task =>
      task.id !== id
        ? task
        : {
          ...task,
          title: title !== undefined && title !== '' ? title.slice(0, TITLE_MAX) : task.title,
          status: isStatus(request.status) ? request.status : task.status,
          updatedAt: Date.now(),
        },
    ))
  }

  remove(payload: unknown): Promise<WorkbenchRouteEnvelope<TaskSnapshot>> {
    const request = payload as Partial<TaskDeleteRequest>
    const id = typeof request.id === 'string' ? request.id : ''
    if (!this.snapshot.tasks.some(task => task.id === id)) {
      return Promise.resolve(envelopeFail('not-found', 'no such task'))
    }
    return this.commit(() => this.snapshot.tasks.filter(task => task.id !== id))
  }
}

function basenameSafe(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index === -1 ? path : path.slice(index + 1)
}
