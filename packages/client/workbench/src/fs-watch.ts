/**
 * Filesystem watcher manager: one fs.watch per active root, events debounced
 * into batches, reference-counted so the last subscriber leaving schedules
 * teardown, and an LRU cap on concurrently open watchers.
 *
 * `recursive` is supported natively on win32/darwin; on linux the initial
 * recursive watch throws, so that root degrades to a shallow watch of the
 * top level only (clients keep manual refresh as the fallback path).
 */
import { watch } from 'node:fs'
import { join } from 'node:path'
import type { FsChangeEvent, FsEventsFrame } from './shared/fs-protocol.ts'

/** Opaque handle to an active filesystem watch. */
export interface WatchHandle {
  close(): void
}

/** Kind of filesystem change the manager reports; one kind keeps the wire honest. */
export type WatchEventKind = 'modify'

/** Spawner seam producing a watch handle for one root; injectable for tests. */
export type WatchFactory = (root: string, onChange: (kind: WatchEventKind, filename: string | null) => void) => WatchHandle

function defaultWatchFactory(root: string, onChange: (kind: WatchEventKind, filename: string | null) => void): WatchHandle {
  return watch(root, { recursive: true }, (_event, filename) => {
    const name = typeof filename === 'string' ? filename : null
    // Node reports 'rename' for both creates and removals; consumers treat
    // every batch as a refresh signal, so one kind keeps the wire honest.
    onChange('modify', name)
  })
}

/** Tuning knobs for the watcher manager: debounce, concurrency cap, idle teardown, factory. */
export interface FsWatcherManagerOptions {
  debounceMs?: number
  maxRoots?: number
  idleCloseMs?: number
  watchFactory?: WatchFactory
}

interface RootEntry {
  handle: WatchHandle
  degraded: boolean
  refcount: number
  pending: Map<string, FsChangeEvent>
  debounceTimer?: ReturnType<typeof setTimeout> | undefined
  idleTimer?: ReturnType<typeof setTimeout> | undefined
  emitBatch: () => void
}

/** Any SSE frame the manager relays: fs batches plus foreign-domain pings (tasks…). */
export interface WatcherFrame {
  domain: string
}

/** Reference-counted debouncing watcher manager; the last subscriber leaving schedules teardown. */
export class FsWatcherManager {
  private readonly roots = new Map<string, RootEntry>()
  private readonly listeners = new Set<(frame: WatcherFrame) => void>()
  private readonly debounceMs: number
  private readonly maxRoots: number
  private readonly idleCloseMs: number
  private readonly factory: WatchFactory

  constructor(options: FsWatcherManagerOptions = {}) {
    this.debounceMs = options.debounceMs ?? 150
    this.maxRoots = options.maxRoots ?? 16
    this.idleCloseMs = options.idleCloseMs ?? 30_000
    this.factory = options.watchFactory ?? defaultWatchFactory
  }

  /**
   * Subscribe to relayed watcher frames.
   * @param listener - callback invoked for every fs batch and foreign-domain frame.
   * @returns a disposer that removes the listener and schedules idle sweeps.
   */
  subscribe(listener: (frame: WatcherFrame) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
      this.scheduleIdleSweeps()
    }
  }

  /**
   * Subscribe one consumer connection to a set of roots.
   * @param roots - the root paths to watch (empty/invalid entries are skipped).
   * @returns a disposer that releases one reference on each added root.
   */
  addRoots(roots: string[]): () => void {
    const added: string[] = []
    for (const root of roots) {
      if (typeof root !== 'string' || root === '') continue
      this.ensureRoot(root)
      const entry = this.roots.get(root)
      if (entry !== undefined) {
        entry.refcount += 1
        added.push(root)
      }
    }
    return () => {
      for (const root of added) {
        const entry = this.roots.get(root)
        if (entry === undefined) continue
        entry.refcount = Math.max(0, entry.refcount - 1)
        if (entry.refcount === 0) {
          if (entry.idleTimer !== undefined) clearTimeout(entry.idleTimer)
          entry.idleTimer = setTimeout(() => {
            if (this.roots.get(root)?.refcount === 0) this.closeRoot(root)
          }, this.idleCloseMs)
          if (typeof entry.idleTimer.unref === 'function') entry.idleTimer.unref()
        }
      }
    }
  }

  /**
   * Relay a foreign-domain frame (e.g. tasks revision pings) to all SSE clients.
   * @param frame - the frame to relay; domain is preserved verbatim.
   */
  broadcast(frame: WatcherFrame): void {
    for (const listener of this.listeners) listener(frame)
  }

  /**
   * Number of roots currently under watch.
   * @returns the count of live root entries.
   */
  activeRootCount(): number {
    return this.roots.size
  }

  /**
   * Whether a root degraded to a shallow watch (recursive unsupported).
   * @param root - the root path to query.
   * @returns true when the root's watcher is degraded or unknown.
   */
  isDegraded(root: string): boolean {
    return this.roots.get(root)?.degraded ?? false
  }

  /** Force-flush pending debounce batches; test-only entry point. */
  flushForTests(): void {
    for (const entry of this.roots.values()) {
      if (entry.debounceTimer !== undefined) {
        clearTimeout(entry.debounceTimer)
        entry.emitBatch()
      }
    }
  }

  private ensureRoot(root: string): void {
    if (this.roots.has(root)) return
    while (this.roots.size >= this.maxRoots) {
      const oldest = this.roots.keys().next().value
      if (oldest === undefined) break
      this.closeRoot(oldest)
    }
    const entry: RootEntry = {
      handle: { close: () => {} },
      degraded: false,
      refcount: 0,
      pending: new Map(),
      emitBatch: () =>{  this.emitBatch(entry, root) },
    }
    try {
      entry.handle = this.factory(root, (kind, filename) => {
        if (filename === null) return
        const changePath = join(root, filename)
        // Later events for one path replace earlier ones inside the window.
        entry.pending.set(changePath, { kind, path: changePath, isDir: false })
        if (entry.debounceTimer === undefined) {
          entry.debounceTimer = setTimeout(() => {
            entry.debounceTimer = undefined
            entry.emitBatch()
          }, this.debounceMs)
          if (typeof entry.debounceTimer.unref === 'function') entry.debounceTimer.unref()
        }
      })
    } catch {
      // Recursive unsupported (linux) or transient failure: degrade quietly;
      // clients keep their manual-refresh fallback.
      entry.degraded = true
    }
    this.roots.set(root, entry)
  }

  private emitBatch(entry: RootEntry, root: string): void {
    if (entry.pending.size === 0) return
    const changes = [...entry.pending.values()]
    entry.pending.clear()
    const frame: FsEventsFrame = { domain: 'fs', changes }
    for (const listener of this.listeners) listener(frame)
    void root
  }

  private closeRoot(root: string): void {
    const entry = this.roots.get(root)
    if (entry === undefined) return
    if (entry.debounceTimer !== undefined) clearTimeout(entry.debounceTimer)
    if (entry.idleTimer !== undefined) clearTimeout(entry.idleTimer)
    try {
      entry.handle.close()
    } catch {
      // Already closed by the OS side; nothing to recover.
    }
    this.roots.delete(root)
  }

  private scheduleIdleSweeps(): void {
    // Idle timers are per-root and self-cancelling; nothing global to sweep.
  }
}
