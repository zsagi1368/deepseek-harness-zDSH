/**
 * Client-side state for the file explorer: navigation history, expansion
 * set, and selection. Pure and testable — network access is injected.
 */
import type { ApiClient } from '../../api.ts'
import type { FsEntry, FsSearchResult, FsTreeResult } from '../../../shared/fs-protocol.ts'

export class ExplorerModel {
  private readonly listeners = new Set<() => void>()
  private entriesByDir = new Map<string, FsEntry[]>()
  private truncatedDirs = new Set<string>()

  root = ''
  cwd = ''
  expanded = new Set<string>()
  selected: string | null = null
  loadingDir: string | null = null
  error: string | null = null

  constructor(private readonly api: ApiClient) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  /** Point the explorer at a new workspace root and reset navigation. */
  async openRoot(root: string): Promise<void> {
    const trimmed = root.trim()
    if (trimmed === '') return
    this.root = trimmed
    this.cwd = trimmed
    this.entriesByDir.clear()
    this.expanded = new Set([trimmed])
    await this.loadDir(trimmed, { force: true })
  }

  async loadDir(dir: string, options: { force?: boolean } = {}): Promise<void> {
    if (!options.force && this.entriesByDir.has(dir)) return
    this.loadingDir = dir
    this.error = null
    this.notify()
    try {
      const result = await this.api.call<FsTreeResult>('fs.tree', { cwd: this.root, path: dir })
      this.entriesByDir.set(result.path, result.entries)
      if (result.truncated) this.truncatedDirs.add(result.path)
      else this.truncatedDirs.delete(result.path)
    } catch (cause) {
      this.error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      this.loadingDir = null
      this.notify()
    }
  }

  entriesOf(dir: string): FsEntry[] | undefined {
    return this.entriesByDir.get(dir)
  }

  isTruncated(dir: string): boolean {
    return this.truncatedDirs.has(dir)
  }

  async toggleExpand(dir: string): Promise<void> {
    if (this.expanded.has(dir)) {
      this.expanded.delete(dir)
      this.notify()
      return
    }
    this.expanded.add(dir)
    this.notify()
    await this.loadDir(dir)
  }

  enter(entry: FsEntry): void {
    if (!entry.isDir) return
    this.cwd = entry.path
    void this.loadDir(entry.path)
    this.notify()
  }

  up(): void {
    if (this.cwd === this.root || this.cwd === '') return
    const parent = this.cwd.replace(/[/\\][^/\\]+$/, '')
    if (parent === '' || !this.cwd.startsWith(this.root)) return
    this.cwd = parent
    void this.loadDir(parent)
    this.notify()
  }

  select(path: string | null): void {
    this.selected = path
    this.notify()
  }

  /** Name search scoped to the workspace root. Empty query clears results. */
  async search(query: string): Promise<FsSearchResult> {
    const trimmed = query.trim()
    if (trimmed === '') return { matches: [], truncated: false }
    return this.api.call<FsSearchResult>('fs.search', {
      query: trimmed,
      ...(this.root === '' ? {} : { cwd: this.root, root: this.root }),
    })
  }

  /** Drop cached listings under changed paths so the next render refetches. */
  invalidate(prefixes: Iterable<string>): void {
    let touched = false
    for (const prefix of prefixes) {
      for (const key of [...this.entriesByDir.keys()]) {
        if (key === prefix || key.startsWith(prefix)) {
          this.entriesByDir.delete(key)
          touched = true
        }
      }
    }
    if (touched && this.cwd !== '') void this.loadDir(this.cwd, { force: true })
  }
}

/** Sort entries the way the tree renders them (server pre-sorts; this guards local merges). */
export function sortEntries(entries: readonly FsEntry[]): FsEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}
