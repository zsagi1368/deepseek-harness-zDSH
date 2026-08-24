/**
 * File-workbench wire vocabulary shared by host routes and client panels.
 * Every `/workbench/api/fs.*` response uses the common envelope:
 * `{ ok: true, value }` or `{ ok: false, error: { code, message } }`.
 * Paths over the wire are ABSOLUTE workspace paths; the host re-checks
 * containment on every call (client assertions are never trusted).
 */
import type { WorkbenchRouteEnvelope } from './protocol-envelope.ts'

export type FsEnvelope<T> = WorkbenchRouteEnvelope<T>

/** One directory row. `path` is absolute; `broken` marks dead symlinks. */
export interface FsEntry {
  name: string
  path: string
  isDir: boolean
  isSymlink: boolean
  broken?: boolean
  size?: number
}

// ── fs.tree ────────────────────────────────────────────────────────────────
export interface FsTreeRequest {
  /** Absolute directory to list. */
  path: string
}

export interface FsTreeResult {
  path: string
  entries: FsEntry[]
  truncated: boolean
}

// ── fs.read ────────────────────────────────────────────────────────────────
export interface FsReadRequest {
  path: string
  /**
   * Byte cap for text reads; larger files return `truncated: true` with the
   * head. Host clamps against its own configured maximum.
   */
  maxBytes?: number
}

export type FsReadResult =
  | { kind: 'text'; content: string; truncated: boolean; size: number }
  | { kind: 'binary'; size: number; truncated: boolean; headBase64: string }

// ── fs.write ───────────────────────────────────────────────────────────────
export interface FsWriteRequest {
  path: string
  content: string
  encoding?: 'utf8'
}

export interface FsWriteResult {
  saved: true
  size: number
}

// ── fs.mkdir ───────────────────────────────────────────────────────────────
export interface FsMkdirRequest {
  path: string
  recursive?: boolean
}

export interface FsMkdirResult {
  created: true
}

// ── fs.rename ──────────────────────────────────────────────────────────────
export interface FsRenameRequest {
  from: string
  to: string
}

export interface FsRenameResult {
  moved: true
}

// ── fs.delete ──────────────────────────────────────────────────────────────
export interface FsDeleteRequest {
  path: string
  recursive?: boolean
}

export interface FsDeleteResult {
  deleted: true
}

// ── fs.search ──────────────────────────────────────────────────────────────
export interface FsSearchRequest {
  /** Substring (case-insensitive) matched against file and dir names. */
  query: string
  /** Directory to scope the search; defaults to the workspace root. */
  root?: string
  /** Hard result cap before truncation; host may lower it further. */
  limit?: number
}

export interface FsSearchMatch {
  path: string
  isDir: boolean
}

export interface FsSearchResult {
  matches: FsSearchMatch[]
  truncated: boolean
}

// ── watcher events (SSE `/workbench/events`) ───────────────────────────────
export type FsChangeEventKind = 'create' | 'modify' | 'remove'

export interface FsChangeEvent {
  kind: FsChangeEventKind
  /** Absolute path affected. */
  path: string
  /** True when the entry is a directory. */
  isDir: boolean
}

/** SSE frame payload for filesystem changes (one batch per debounce tick). */
export interface FsEventsFrame {
  domain: 'fs'
  changes: FsChangeEvent[]
}
