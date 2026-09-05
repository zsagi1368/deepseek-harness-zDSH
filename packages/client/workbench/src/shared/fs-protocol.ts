/**
 * File-workbench wire vocabulary shared by host routes and client panels.
 * Every `/workbench/api/fs.*` response uses the common envelope:
 * `{ ok: true, value }` or `{ ok: false, error: { code, message } }`.
 * Paths over the wire are ABSOLUTE workspace paths; the host re-checks
 * containment on every call (client assertions are never trusted).
 */
import type { WorkbenchRouteEnvelope } from './protocol-envelope.ts'

/** Common success/failure envelope wrapping every fs.* result. */
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
/** Request payload for fs.tree: the absolute directory to list. */
export interface FsTreeRequest {
  /** Absolute directory to list. */
  path: string
}

/** Result payload for fs.tree: entries plus the truncation flag. */
export interface FsTreeResult {
  path: string
  entries: FsEntry[]
  truncated: boolean
}

// ── fs.read ────────────────────────────────────────────────────────────────
/** Request payload for fs.read: target path plus an optional byte cap. */
export interface FsReadRequest {
  path: string
  /**
   * Byte cap for text reads; larger files return `truncated: true` with the
   * head. Host clamps against its own configured maximum.
   */
  maxBytes?: number
}

/** Result payload for fs.read: text content or a binary head. */
export type FsReadResult =
  | { kind: 'text'; content: string; truncated: boolean; size: number }
  | { kind: 'binary'; size: number; truncated: boolean; headBase64: string }

// ── fs.write ───────────────────────────────────────────────────────────────
/** Request payload for fs.write: path, content, and encoding. */
export interface FsWriteRequest {
  path: string
  content: string
  encoding?: 'utf8'
}

/** Result payload for fs.write: saved confirmation plus final size. */
export interface FsWriteResult {
  saved: true
  size: number
}

// ── fs.mkdir ───────────────────────────────────────────────────────────────
/** Request payload for fs.mkdir: path and recursiveness. */
export interface FsMkdirRequest {
  path: string
  recursive?: boolean
}

/** Result payload for fs.mkdir: created confirmation. */
export interface FsMkdirResult {
  created: true
}

// ── fs.rename ──────────────────────────────────────────────────────────────
/** Request payload for fs.rename: source and destination paths. */
export interface FsRenameRequest {
  from: string
  to: string
}

/** Result payload for fs.rename: moved confirmation. */
export interface FsRenameResult {
  moved: true
}

// ── fs.delete ──────────────────────────────────────────────────────────────
/** Request payload for fs.delete: path and recursiveness. */
export interface FsDeleteRequest {
  path: string
  recursive?: boolean
}

/** Result payload for fs.delete: deleted confirmation. */
export interface FsDeleteResult {
  deleted: true
}

// ── fs.search ──────────────────────────────────────────────────────────────
/** Request payload for fs.search: query plus optional scope and cap. */
export interface FsSearchRequest {
  /** Substring (case-insensitive) matched against file and dir names. */
  query: string
  /** Directory to scope the search; defaults to the workspace root. */
  root?: string
  /** Hard result cap before truncation; host may lower it further. */
  limit?: number
}

/** One search hit: the matched path and whether it is a directory. */
export interface FsSearchMatch {
  path: string
  isDir: boolean
}

/** Result payload for fs.search: matches plus the truncation flag. */
export interface FsSearchResult {
  matches: FsSearchMatch[]
  truncated: boolean
}

// ── watcher events (SSE `/workbench/events`) ───────────────────────────────
/** Kind of filesystem change carried by watcher events. */
export type FsChangeEventKind = 'create' | 'modify' | 'remove'

/** One filesystem change inside a watcher batch. */
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
