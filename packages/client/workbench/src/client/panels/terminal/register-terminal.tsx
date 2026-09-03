/**
 * Terminal feature: one panel hosting up to the per-session quota of
 * terminal tabs. Reconnect semantics live in TerminalView.
 */
import { useState } from 'react'
import type { WorkbenchRegistryApi } from '../../registry.ts'
import { useWorkbenchT } from '../../shell/context.ts'
import { getWorkspaceRoot } from '../../shell/workspace-root.ts'
import { TerminalView } from './TerminalView.tsx'

const MAX_TERMINALS = 3

export function registerTerminalFeature(registry: WorkbenchRegistryApi): () => void {
  return registry.registerPanel({
    id: 'term:main',
    titleKey: 'terminalTitle',
    order: 40,
    component: function TerminalPanel() {
      const t = useWorkbenchT()
      const [terminals, setTerminals] = useState<Array<{ id: number }>>([{ id: 1 }])
      const [activeId, setActiveId] = useState(1)
      const [nonce, setNonce] = useState(0)

      const addTerminal = (): void => {
        if (terminals.length >= MAX_TERMINALS) return
        const id = Math.max(0, ...terminals.map(terminal => terminal.id)) + 1
        setTerminals(previous => [...previous, { id }])
        setActiveId(id)
      }

      const closeTerminal = (id: number): void => {
        setTerminals((previous) => {
          const next = previous.filter(terminal => terminal.id !== id)
          if (next.length === 0) return [{ id: id + 1 }]
          if (id === activeId) setActiveId(next[next.length - 1]?.id ?? next[0]?.id ?? id + 1)
          return next
        })
        // Remount key bump so closed ids never collide with fresh ones.
        setNonce(value => value + 1)
      }

      const active = terminals.find(terminal => terminal.id === activeId) ?? terminals[0]
      const cwd = getWorkspaceRoot()

      return (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 4 }}>
            {terminals.map(terminal => (
              <span key={terminal.id} style={{ display: 'inline-flex', alignItems: 'center' }}>
                <button className="zdsh-wb-tab" aria-selected={terminal.id === active?.id} onClick={() =>{  setActiveId(terminal.id) }}>
                  {t('terminalTitle')} {String(terminal.id)}
                </button>
                <button className="zdsh-wb-iconbtn" style={{ fontSize: 9 }} onClick={() =>{  closeTerminal(terminal.id) }}>×</button>
              </span>
            ))}
            {terminals.length < MAX_TERMINALS ? (
              <button className="zdsh-wb-iconbtn" title={t('terminalNewTab')} onClick={addTerminal}>＋</button>
            ) : null}
          </div>
          {active !== undefined ? (
            <TerminalView
              key={`${active.id}-${nonce}`}
              termId={`t${active.id}`}
              {...(cwd === '' ? {} : { cwd })}
            />
          ) : null}
        </div>
      )
    },
  })
}
