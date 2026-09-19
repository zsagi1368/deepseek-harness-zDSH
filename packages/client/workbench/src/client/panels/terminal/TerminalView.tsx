import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { useWorkbenchT } from '../../shell/context.ts'
import { XTERM_CSS } from '../../shell/xterm-css.ts'

/**
 * Terminal panel body: one xterm.js instance wired over
 * `/workbench/ws/terminal`. Reconnect reattaches to the same server-side
 * process and replays the ring buffer, so a dropped socket does not lose
 * the session. The pty-unavailable state renders the repair banner instead
 * of a dead grid.
 */

let styleInjected = false
function injectXtermCss(): void {
  if (styleInjected || typeof document === 'undefined') return
  const element = document.createElement('style')
  element.id = 'zdsh-workbench-xterm-css'
  element.textContent = XTERM_CSS
  document.head.appendChild(element)
  styleInjected = true
}

type Phase =
  | { status: 'connecting' }
  | { status: 'banner'; code: string; message: string }
  | { status: 'live' }
  | { status: 'exited'; exitCode: number }

export function TerminalView(props: { cwd?: string; termId: string }): React.ReactNode {
  const t = useWorkbenchT()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [phase, setPhase] = useState<Phase>({ status: 'connecting' })
  const cwdRef = useRef(props.cwd)
  cwdRef.current = props.cwd

  useEffect(() => {
    injectXtermCss()
    const container = hostRef.current
    if (container === null) return

    const term = new Terminal({
      convertEol: false,
      fontSize: 12,
      cursorBlink: true,
      allowProposedApi: true,
    })
    term.open(container)
    term.focus()

    let disposed = false
    let socket: WebSocket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    const decoder = new TextDecoder('utf-8')

    const decodeBase64 = (base64: string): string =>
      decoder.decode(Uint8Array.from(atob(base64), char => char.charCodeAt(0)))

    const sessionId = 'web'
    const termId = props.termId

    const connect = (): void => {
      if (disposed) return
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(`${protocol}://${window.location.host}/workbench/ws/terminal`)

      socket.onopen = () => {
        socket?.send(JSON.stringify({
          t: 'open', sessionId, termId,
          cwd: cwdRef.current || undefined,
        }))
      }

      socket.onmessage = (event) => {
        let message: import('../../../shared/terminal-protocol.ts').TerminalServerMessage
        try {
          message = JSON.parse(String(event.data)) as typeof message
        } catch {
          return
        }
        if (message.sessionId !== sessionId || message.termId !== termId) return
        switch (message.t) {
          case 'attached':
            setPhase({ status: 'live' })
            if (message.replayBase64 !== '') term.write(decodeBase64(message.replayBase64))
            break
          case 'data':
            term.write(decodeBase64(message.dataBase64))
            break
          case 'exit':
            setPhase({ status: 'exited', exitCode: message.exitCode })
            term.write(`\r\n\x1b[90m[进程已退出，退出码 ${String(message.exitCode)}]\x1b[0m\r\n`)
            break
          case 'error':
            if (message.code === 'pty-unavailable' || message.code === 'quota-exceeded' || message.code === 'spawn-failed' || message.code === 'shell-unresolved') {
              setPhase({ status: 'banner', code: message.code, message: message.message })
            } else {
              term.write(`\r\n\x1b[31m[错误 ${message.code}] ${message.message}\x1b[0m\r\n`)
            }
            break
        }
      }

      socket.onclose = () => {
        if (disposed) return
        // Server process lingers through its grace period; retry after a beat.
        retryTimer = setTimeout(connect, 1200)
      }
    }

    connect()

    term.onData((data) => {
      socket?.send(JSON.stringify({ t: 'input', sessionId, termId, data }))
    })
    term.onResize(({ cols, rows }) => {
      socket?.send(JSON.stringify({ t: 'resize', sessionId, termId, cols, rows }))
    })

    return () => {
      disposed = true
      if (retryTimer !== undefined) clearTimeout(retryTimer)
      try {
        socket?.send(JSON.stringify({ t: 'close', sessionId, termId }))
      } catch {
        // Socket already gone.
      }
      socket?.close()
      term.dispose()
    }
  }, [props.termId])

  return (
    <div>
      {phase.status === 'banner' ? (
        <div className="zdsh-wb-orphan">
          <div>{t('terminalUnavailableBefore')}{phase.code}{t('terminalUnavailableAfter')}</div>
          <div>{phase.message}</div>
          <div style={{ marginTop: 6, fontFamily: 'ui-monospace, monospace', fontSize: 11 }}>
            {t('terminalRepairCommand')}
          </div>
        </div>
      ) : null}
      <div ref={hostRef} style={{ minHeight: 320 }} />
      {phase.status === 'exited' ? (
        <button className="zdsh-wb-tab" onClick={() =>{  setPhase({ status: 'connecting' }) }}>{t('restartTerminal')}</button>
      ) : null}
    </div>
  )
}
