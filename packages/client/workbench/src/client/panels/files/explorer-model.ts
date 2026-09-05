/**
 * Client-side state for the file explorer: navigation history, expansion
 * set, and selection. Pure and testable — network access is injected.
 */
import type { ApiClient } from '../../api.ts'
import type { FsEntry, FsSearchResult, FsTreeResult } from '../../../shared/fs-protocol.ts'

/** Explorer state and navigation, pure and testable — network access is injected via ApiClient. */
export class ExplorerModel {
  private readonly listeners = new Set<() => void>()
  private entriesByDir = new Map<string, FsEntry[]>()
  private truncatedDirs = new Set<string>()

  /** Workspace root the explorer is rooted at. */
  root = ''
  /** Directory currently rendered in the main list. */
  cwd = ''
  /** Set of directory paths currently expanded in the tree. */
  expanded = new Set<string>()
  /** Currently selected entry path, or null when nothing is selected. */
  selected: string | null = null
  /** Directory currently being loaded, or null when idle. */
  loadingDir: string | null = null
  /** Last load error message, or null when the last load succeeded. */
  error: string | null = null

  constructor(private readonly api: ApiClient) {}

  /**
   * Subscribe to explorer state changes.
   * @param listener - callback invoked after every state mutation.
   * @returns a disposer that removes the listener.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  /**
   * Point the explorer at a new workspace root and reset navigation.
   * @param root - the absolute workspace root path.
   */
  async openRoot(root: string): Promise<void> {
    const trimmed = root.trim()
    if (trimmed === '') return
    this.root = trimmed
    this.cwd = trimmed
    this.entriesByDir.clear()
    this.expanded = new Set([trimmed])
    await this.loadDir(trimmed, { force: true })
  }

  /**
   * Load one directory's listing (cached unless `force` is set).
   * @param dir - the absolute directory path to list.
   * @param options - optional `force` to refetch even when cached.
   */
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

  /**
   * Cached listing for one directory.
   * @param dir - the absolute directory path.
   * @returns the cached entries, or undefined when not loaded yet.
   */
  entriesOf(dir: string): FsEntry[] | undefined {
    return this.entriesByDir.get(dir)
  }

  /**
   * Whether a directory's listing was truncated by the server limit.
   * @param dir - the absolute directory path.
   * @returns true when the cached listing was truncated.
   */
  isTruncated(dir: string): boolean {
    return this.truncatedDirs.has(dir)
  }

  /**
   * Expand or collapse one directory.
   * @param dir - the absolute directory path to toggle.
   */
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

  /**
   * Navigate into a directory entry.
   * @param entry - the directory entry to enter.
   */
  enter(entry: FsEntry): void {
    if (!entry.isDir) return
    this.cwd = entry.path
    void this.loadDir(entry.path)
    this.notify()
  }

  /** Navigate to the parent of the current directory (no-op at the root). */
  up(): void {
    if (this.cwd === this.root || this.cwd === '') return
    const parent = this.cwd.replace(/[/\\][^/\\]+$/, '')
    if (parent === '' || !this.cwd.startsWith(this.root)) return
    this.cwd = parent
    void this.loadDir(parent)
    this.notify()
  }

  /**
   * Set the selected entry.
   * @param path - the entry path to select, or null to clear the selection.
   */
  select(path: string | null): void {
    this.selected = path
    this.notify()
  }

  /**
   * Name search scoped to the workspace root. Empty query clears results.
   * @param query - the search text; an empty query yields an empty result.
   * @returns the search result (matches plus truncation flag).
   */
  async search(query: string): Promise<FsSearchResult> {
    const trimmed = query.trim()
    if (trimmed === '') return { matches: [], truncated: false }
    return this.api.call<FsSearchResult>('fs.search', {
      query: trimmed,
      ...(this.root === '' ? {} : { cwd: this.root, root: this.root }),
    })
  }

  /**
   * Drop cached listings under changed paths so the next render refetches.
   * @param prefixes - path prefixes whose cached listings should be dropped.
   */
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

/**
 * Sort entries the way the tree renders them (server pre-sorts; this guards local merges).
 * @param entries - the entries to sort (not mutated).
 * @returns a new array with directories first, then names in locale order.
 */
export function sortEntries(entries: readonly FsEntry[]): FsEntry[] {
  return [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}
