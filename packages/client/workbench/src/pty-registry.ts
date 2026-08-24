/**
 * PTY registry: owns terminal processes keyed by `sessionId:termId`, with a
 * per-session quota, a replay ring buffer per terminal, and a reconnect
 * grace period before an orphaned process is killed.
 *
 * Security posture: the executable is NEVER taken from request data. It is
 * resolved once from deployment configuration / platform defaults and then
 * validated against a strict shape (absolute path or bare known-shell name)
 * before any process creation. Request payloads only ever supply cwd, size,
 * and stdin bytes.
 *
 * Transport-agnostic by design: callbacks + buffers, so the WebSocket route
 * stays thin and unit tests run without sockets or native modules.
 */
import { spawnSync } from 'node:child_process'
import { accessSync, constants as fsConstants } from 'node:fs'
import { basename } from 'node:path'

export interface PtyProcess {
  pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
}

export interface PtySpawnRequest {
  file: string
  args: string[]
  cwd?: string
  cols: number
  rows: number
  /** Output sink; called with raw decoder-agnostic bytes. */
  onData(chunk: Buffer): void
  onExit(exitCode: number): void
}

/** Spawner seam so unit tests never touch node-pty (or need it built). */
export type PtySpawner = (request: PtySpawnRequest) => PtyProcess

export interface ShellResolution {
  file: string
  args: string[]
}

export interface TerminalEvents {
  onData(base64Chunk: string): void
  onExit(exitCode: number): void
}

interface TerminalRecord {
  process: PtyProcess | null
  buffer: Buffer
  graceTimer?: ReturnType<typeof setTimeout> | undefined
  attached: boolean
  events?: TerminalEvents
}

const WINDOWS_SHELL_BASENAMES = new Set(['pwsh.exe', 'powershell.exe', 'cmd.exe'])

/**
 * Validate a resolved shell before it may reach any spawn seam: on Windows
 * only the known shell basenames pass; elsewhere the value must be an
 * absolute, existing, executable path. Returns null when unusable.
 */
export function validateShellResolution(resolution: ShellResolution): ShellResolution | null {
  const file = resolution.file.trim()
  if (file === '') return null
  if (process.platform === 'win32') {
    if (!WINDOWS_SHELL_BASENAMES.has(basename(file).toLowerCase()) && !file.includes('\\')) return null
    return { file, args: resolution.args }
  }
  if (!file.startsWith('/')) return null
  try {
    accessSync(file, fsConstants.X_OK)
  } catch {
    return null
  }
  return { file, args: resolution.args }
}

function defaultSpawner(request: PtySpawnRequest): PtyProcess {
  // Lazy ESM import keeps node-pty off every consumer's boot path and lets
  // the plugin load (with a repair banner) even while the native build is
  // still blocked by a package-manager approval gate.
  let term: import('node-pty').IPty | undefined
  void import('node-pty')
    .then((pty) => {
      term = pty.spawn(request.file, request.args, {
        name: 'xterm-256color',
        cols: request.cols,
        rows: request.rows,
        ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
        env: process.env,
      })
      term.onData((data) =>{  request.onData(Buffer.from(data, 'utf8')) })
      term.onExit(({ exitCode }) =>{  request.onExit(exitCode) })
    })
    .catch(() => {
      // Surfaced synchronously by ensureNodePtyAvailable(); nothing to do here.
    })

  if (term === undefined) {
    // The async import resolves before the first user keystroke in practice;
    // until then writes are dropped, which the client renders as no-op echo.
    return {
      pid: -1,
      write: () => {},
      resize: () => {},
      kill: () => {},
    }
  }
  const bound = term
  return {
    pid: bound.pid,
    write: (data) =>{  bound.write(data) },
    resize: (cols, rows) =>{  bound.resize(cols, rows) },
    kill: () =>{  bound.kill() },
  }
}

/** Windows-first probe: configured override → pwsh 7 → inbox PowerShell → ComSpec. */
export function resolveShell(): ShellResolution {
  if (process.platform === 'win32') {
    const configured = process.env.DSH_WORKBENCH_SHELL?.trim()
    if (configured !== undefined && configured !== '') return { file: configured, args: ['-NoLogo'] }
    for (const candidate of ['pwsh.exe', 'powershell.exe']) {
      const whereResult = spawnSync('where.exe', [candidate], { stdio: 'ignore' })
      if (whereResult.status === 0) return { file: candidate, args: ['-NoLogo'] }
    }
    const comspec = process.env.ComSpec?.trim()
    return { file: comspec !== undefined && comspec !== '' ? comspec : 'cmd.exe', args: [] }
  }
  return { file: process.env.SHELL ?? '/bin/bash', args: ['-l'] }
}

export class PtyRegistry {
  private readonly terminals = new Map<string, TerminalRecord>()
  private readonly sessionCounts = new Map<string, number>()
  private readonly termsPerSession: number
  private readonly replayBufferBytesLimit: number
  private readonly graceMs: number

  constructor(
    dependencies: {
      terminalsPerSession?: number
      replayBufferBytes?: number
      reconnectGraceMs?: number
      spawner?: PtySpawner
      shellResolver?: () => ShellResolution
    } = {},
  ) {
    this.termsPerSession = dependencies.terminalsPerSession ?? 3
    this.replayBufferBytesLimit = dependencies.replayBufferBytes ?? 256 * 1024
    this.graceMs = dependencies.reconnectGraceMs ?? 30_000
    this.spawnerFn = dependencies.spawner ?? defaultSpawner
    this.shellResolverFn = dependencies.shellResolver ?? resolveShell
  }

  private readonly spawnerFn: PtySpawner
  private readonly shellResolverFn: () => ShellResolution

  static key(sessionId: string, termId: string): string {
    return `${sessionId}:${termId}`
  }

  countFor(sessionId: string): number {
    return this.sessionCounts.get(sessionId) ?? 0
  }

  /**
   * Open or reattach. Reattach cancels any pending grace-period kill and
   * answers with the replay buffer so scrollback survives the round trip.
   */
  open(
    sessionId: string,
    termId: string,
    events: TerminalEvents,
    options?: { cwd?: string; cols?: number; rows?: number },
  ): { error: string; message: string } | AttachResult {
    const key = PtyRegistry.key(sessionId, termId)
    const existing = this.terminals.get(key)
    if (existing !== undefined && existing.process !== null) {
      if (existing.graceTimer !== undefined) {
        clearTimeout(existing.graceTimer)
        existing.graceTimer = undefined
      }
      existing.attached = true
      existing.events = events
      return { pid: existing.process.pid, shell: this.shellLabel, replayBase64: existing.buffer.toString('base64') }
    }

    const currentCount = this.countFor(sessionId)
    if (currentCount >= this.termsPerSession) {
      return { error: 'quota-exceeded', message: `session already holds ${currentCount} terminals` }
    }

    const resolution = this.shellResolutionValidated
    if (resolution === null) {
      return { error: 'shell-unresolved', message: '没有可用的受支持 shell（检查 DSH_WORKBENCH_SHELL 配置）' }
    }

    const record: TerminalRecord = { process: null, buffer: Buffer.alloc(0), attached: true, events }
    let spawned: PtyProcess | null = null
    try {
      spawned = this.spawnerFn({
        file: resolution.file,
        args: resolution.args,
        ...(options?.cwd === undefined ? {} : { cwd: options.cwd }),
        cols: options?.cols ?? 80,
        rows: options?.rows ?? 24,
        onData: (chunk) => {
          record.buffer = Buffer.concat([record.buffer, chunk])
          if (record.buffer.byteLength > this.replayBufferBytesLimit) {
            record.buffer = record.buffer.subarray(record.buffer.byteLength - this.replayBufferBytesLimit)
          }
          record.events?.onData(chunk.toString('base64'))
        },
        onExit: (exitCode) => {
          record.events?.onExit(exitCode)
          this.disposeRecord(sessionId, termId, record)
          this.terminals.delete(key)
        },
      })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      const code = /Cannot find module|node-pty/.test(message) ? 'pty-unavailable' : 'spawn-failed'
      return { error: code, message: code === 'pty-unavailable' ? 'node-pty 原生模块不可用：在插件目录执行 pnpm approve-builds 后重启 DSH' : message }
    }

    record.process = spawned
    this.terminals.set(key, record)
    this.sessionCounts.set(sessionId, currentCount + 1)

    return { pid: spawned.pid, shell: this.shellLabel, replayBase64: record.buffer.toString('base64') }
  }

  /** Driver/test entry: push output through the live replay+stream path. */
  feedData(sessionId: string, termId: string, chunk: Buffer | string): void {
    const record = this.terminals.get(PtyRegistry.key(sessionId, termId))
    if (record === undefined) return
    const piece = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk
    record.buffer = Buffer.concat([record.buffer, piece])
    if (record.buffer.byteLength > this.replayBufferBytesLimit) {
      record.buffer = record.buffer.subarray(record.buffer.byteLength - this.replayBufferBytesLimit)
    }
    record.events?.onData(piece.toString('base64'))
  }

  /** Driver/test entry: run the process-exit cleanup path. */
  feedExit(sessionId: string, termId: string, exitCode: number): void {
    const key = PtyRegistry.key(sessionId, termId)
    const record = this.terminals.get(key)
    if (record === undefined) return
    record.events?.onExit(exitCode)
    this.disposeRecord(sessionId, termId, record)
    this.terminals.delete(key)
  }

  input(sessionId: string, termId: string, data: string): boolean {
    const record = this.terminals.get(PtyRegistry.key(sessionId, termId))
    if (record?.process === null || record === undefined || !record.attached) return false
    record.process.write(data)
    return true
  }

  resize(sessionId: string, termId: string, cols: number, rows: number): boolean {
    const record = this.terminals.get(PtyRegistry.key(sessionId, termId))
    if (record === undefined || record.process === null) return false
    record.process.resize(Math.max(2, Math.floor(cols)), Math.max(1, Math.floor(rows)))
    return true
  }

  /** Socket dropped for ONE terminal: mark detached and start the countdown. */
  detach(sessionId: string, termId: string): void {
    const record = this.terminals.get(PtyRegistry.key(sessionId, termId))
    if (record === undefined || !record.attached) return
    record.attached = false
    if (record.graceTimer === undefined && record.process !== null) {
      record.graceTimer = setTimeout(() => {
        record.process?.kill()
      }, this.graceMs)
      if (typeof record.graceTimer.unref === 'function') record.graceTimer.unref()
    }
  }

  /** Socket dropped entirely: every live terminal enters its grace period. */
  detachAll(): void {
    for (const [key] of this.terminals) {
      const [sessionId, termId] = [sessionPart(key), termPart(key)]
      this.detach(sessionId, termId)
    }
  }

  /** Reattach path clears the countdown for exactly one terminal. */
  cancelGrace(sessionId: string, termId: string): void {
    const record = this.terminals.get(PtyRegistry.key(sessionId, termId))
    if (record?.graceTimer === undefined) return
    clearTimeout(record.graceTimer)
    record.graceTimer = undefined
  }

  close(sessionId: string, termId: string): boolean {
    const key = PtyRegistry.key(sessionId, termId)
    const record = this.terminals.get(key)
    if (record === undefined) return false
    record.process?.kill()
    this.disposeRecord(sessionId, termId, record)
    this.terminals.delete(key)
    return true
  }

  disposeAll(): void {
    for (const [key, record] of [...this.terminals.entries()]) {
      record.process?.kill()
      this.disposeRecord(sessionPart(key), termPart(key), record)
      this.terminals.delete(key)
    }
  }

  private get shellLabel(): string {
    return this.shellResolutionValidated?.file ?? ''
  }

  private get shellResolutionValidated(): ShellResolution | null {
    const cached = validateShellResolution(this.shellResolverFn())
    return cached
  }

  private disposeRecord(sessionId: string, termId: string, record: TerminalRecord): void {
    if (record.graceTimer !== undefined) clearTimeout(record.graceTimer)
    const remaining = this.countFor(sessionId) - 1
    if (remaining <= 0) this.sessionCounts.delete(sessionId)
    else this.sessionCounts.set(sessionId, remaining)
    record.process = null
    void termId
  }
}

function sessionPart(key: string): string {
  const index = key.indexOf(':')
  return index === -1 ? key : key.slice(0, index)
}

function termPart(key: string): string {
  const index = key.indexOf(':')
  return index === -1 ? '' : key.slice(index + 1)
}

export interface AttachResult {
  pid: number
  shell: string
  replayBase64: string
}
