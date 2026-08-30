/**
 * Typed client access to the workbench host routes. The envelope contract
 * lives in shared/protocol-envelope.ts; this wrapper turns failures into a
 * single error type carrying the stable code, and owns the SSE reconnect
 * loop for the watcher channel.
 */
import type { FsEventsFrame } from '../shared/fs-protocol.ts'

/** Error thrown for every failed workbench API call, carrying the stable envelope code. */
export class ApiError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'ApiError'
  }
}

interface Envelope<T> {
  ok: boolean
  value?: T
  error?: { code: string; message: string }
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  let parsed: unknown
  try {
    parsed = await response.json()
  } catch {
    throw new ApiError('bad-response', `workbench api returned non-JSON (HTTP ${response.status})`)
  }
  const envelope = parsed as Envelope<T>
  if (envelope.ok && envelope.value !== undefined) return envelope.value
  if (!envelope.ok && envelope.error !== undefined) {
    throw new ApiError(envelope.error.code, envelope.error.message)
  }
  throw new ApiError('bad-envelope', 'workbench api response had neither value nor error')
}

/** Client face of the workbench host API: calls a route method and unwraps the envelope. */
export interface ApiClient {
  /** POST `/workbench/api/<method>` with a JSON body, unwrapping the envelope. */
  call<TResult>(method: string, payload?: unknown): Promise<TResult>
}

/**
 * Build an ApiClient that targets the given base URL (defaults to the same origin).
 * @param baseUrl - optional URL prefix for the workbench routes.
 * @returns a ready-to-use ApiClient instance.
 */
export function createApiClient(baseUrl = ''): ApiClient {
  return {
    async call<TResult>(method: string, payload?: unknown): Promise<TResult> {
      const response = await fetch(`${baseUrl}/workbench/api/${encodeURIComponent(method)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      })
      return parseEnvelope<TResult>(response)
    },
  }
}

/** Disposer that permanently closes the subscribed event stream. */
export type Unsubscribe = () => void

/**
 * Subscribe to the fs event stream with automatic reconnect (exponential
 * backoff capped at 15s). Returns a disposer that closes the stream and
 * stops reconnection permanently.
 * @param roots - absolute workspace root paths whose changes to watch.
 * @param onFrame - callback invoked for every fs frame received on the stream.
 * @param options - optional `signal` to abort the subscription and `baseUrl` override.
 * @returns a disposer that closes the stream and stops reconnection.
 */
export function subscribeFsEvents(
  roots: string[],
  onFrame: (frame: FsEventsFrame) => void,
  options: { signal?: AbortSignal; baseUrl?: string } = {},
): Unsubscribe {
  const controller = new AbortController()
  const signal = options.signal
  if (signal !== undefined) {
    signal.addEventListener('abort', () =>{  controller.abort() }, { once: true })
  }
  let attempt = 0
  let stopped = false
  let backoffTimer: ReturnType<typeof setTimeout> | undefined

  const connect = (): void => {
    if (stopped) return
    const url = `${options.baseUrl ?? ''}/workbench/events?roots=${encodeURIComponent(JSON.stringify(roots))}`
    const source = new EventSource(url)
    source.onmessage = (message) => {
      try {
        const frame = JSON.parse(String(message.data)) as { domain?: unknown }
        if (frame.domain === 'fs') onFrame(frame as FsEventsFrame)
      } catch {
        // Malformed frame: ignore, the stream stays healthy.
      }
    }
    source.onerror = () => {
      source.close()
      if (stopped || controller.signal.aborted) return
      const delay = Math.min(15_000, 500 * 2 ** Math.min(attempt, 5))
      attempt += 1
      backoffTimer = setTimeout(connect, delay)
    }
    source.onopen = () => {
      attempt = 0
    }
  }

  connect()
  return () => {
    stopped = true
    if (backoffTimer !== undefined) clearTimeout(backoffTimer)
    controller.abort()
  }
}
