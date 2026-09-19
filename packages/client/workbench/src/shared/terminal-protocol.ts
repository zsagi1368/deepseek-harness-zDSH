/**
 * Terminal wire vocabulary for the `/workbench/ws/terminal` upgrade route.
 * Messages are JSON in both directions. The host tags every frame it sends
 * with `t`; the client tags every frame it sends with `t` likewise.
 *
 * Replay semantics: a `open` creates (or reattaches to) a terminal keyed by
 * `${sessionId}:${termId}`; the host answers with `attached` carrying up to
 * `replayBytes` of recent output so scrollback survives reconnects. Output
 * chunks stream as base64 `data` frames. The process lingers
 * `graceMs` after a socket drop awaiting reattach, then is killed.
 */
export type TerminalClientMessage =
  | { t: 'open'; sessionId: string; termId: string; cwd?: string }
  | { t: 'input'; sessionId: string; termId: string; data: string }
  | { t: 'resize'; sessionId: string; termId: string; cols: number; rows: number }
  | { t: 'close'; sessionId: string; termId: string }

/** Every frame the host may send over the terminal socket. */
export type TerminalServerMessage =
  | { t: 'attached'; sessionId: string; termId: string; pid: number; shell: string; replayBase64: string; degraded?: string }
  | { t: 'data'; sessionId: string; termId: string; dataBase64: string }
  | { t: 'exit'; sessionId: string; termId: string; exitCode: number }
  | { t: 'error'; sessionId?: string; termId?: string; code: string; message: string }

/** Maximum terminals one session may hold open at once. */
export const TERMINALS_PER_SESSION = 3

/** Ring-buffer bytes of output kept for reconnect replay. */
export const REPLAY_BUFFER_BYTES = 256 * 1024

/** How long a disconnected terminal survives awaiting a reconnect. */
export const RECONNECT_GRACE_MS = 30_000
