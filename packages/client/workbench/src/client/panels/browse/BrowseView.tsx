import { useState } from 'react'
import { useWorkbenchT } from '../../shell/context.ts'
import { judgeUrl } from './url-guard.ts'

interface BrowseTab {
  id: number
  stack: string[]
  index: number
}

/**
 * Sandboxed browser panel: multi-tab, opaque-origin iframes (no
 * allow-same-origin / no top navigation / no referrer), own back-forward
 * stacks (cross-origin history is not inspectable), and a visible sandbox
 * status so the user always knows the containment is on. Frames that refuse
 * embedding simply render blank; 在系统浏览器打开 is one click away.
 */
export function BrowseView(): React.ReactNode {
  const t = useWorkbenchT()
  const [tabs, setTabs] = useState<BrowseTab[]>([{ id: 1, stack: [], index: -1 }])
  const [activeId, setActiveId] = useState(1)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)

  const active = tabs.find(tab => tab.id === activeId) ?? tabs[0]
  const currentUrl = active !== undefined && active.index >= 0 ? active.stack[active.index] ?? null : null

  function updateActive(mutate: (tab: BrowseTab) => BrowseTab): void {
    setTabs(previous => previous.map(tab => (tab.id === activeId ? mutate(tab) : tab)))
  }

  function navigate(raw: string): void {
    const verdict = judgeUrl(raw)
    if (!verdict.allowed) {
      setError(verdict.message)
      return
    }
    setError(null)
    updateActive(tab => ({
      ...tab,
      // A new navigation truncates the forward branch of the stack.
      stack: [...tab.stack.slice(0, tab.index + 1), verdict.url],
      index: tab.index + 1,
    }))
  }

  function addTab(): void {
    const id = Math.max(0, ...tabs.map(tab => tab.id)) + 1
    setTabs(previous => [...previous, { id, stack: [], index: -1 }])
    setActiveId(id)
  }

  function closeTab(id: number): void {
    setTabs((previous) => {
      const next = previous.filter(tab => tab.id !== id)
      if (next.length === 0) return [{ id: id + 1, stack: [], index: -1 }]
      return next
    })
    if (id === activeId) {
      const remaining = tabs.filter(tab => tab.id !== id)
      setActiveId(remaining[remaining.length - 1]?.id ?? id + 1)
    }
  }

  const canBack = active !== undefined && active.index > 0
  const canForward = active !== undefined && active.index < active.stack.length - 1

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 380 }}>
      <div className="zdsh-wb-rail" style={{ borderBottom: 'none' }}>
        {tabs.map(tab => (
          <span key={tab.id} style={{ display: 'inline-flex', alignItems: 'center' }}>
            <button
              className="zdsh-wb-tab"
              aria-selected={tab.id === activeId}
              title={tab.stack[tab.index] ?? t('browseBlank')}
              onClick={() =>{  setActiveId(tab.id) }}
            >
              {tab.id === activeId ? '◉ ' : ''}
              {tab.stack.length === 0 ? t('newTab') : safeLabel(tab.stack[tab.index] ?? '')}
            </button>
            <button className="zdsh-wb-iconbtn" style={{ fontSize: 10 }} onClick={() =>{  closeTab(tab.id) }}>×</button>
          </span>
        ))}
        <button className="zdsh-wb-iconbtn" title={t('newTabTitle')} onClick={addTab}>＋</button>
        <span style={{ flex: 1 }} />
        <span title={t('sandboxed')} style={{ fontSize: 10, opacity: 0.7 }}>🛡 {t('browseSandboxBadge')}</span>
      </div>

      <div style={{ display: 'flex', gap: 4, margin: '6px 0' }}>
        <button className="zdsh-wb-iconbtn" disabled={!canBack} onClick={() =>{  updateActive(tab => ({ ...tab, index: Math.max(0, tab.index - 1) })) }}>◀</button>
        <button className="zdsh-wb-iconbtn" disabled={!canForward} onClick={() =>{  updateActive(tab => ({ ...tab, index: Math.min(tab.stack.length - 1, tab.index + 1) })) }}>▶</button>
        <input
          style={{ flex: 1, minWidth: 0 }}
          placeholder={t('urlPlaceholder')}
          value={draft}
          onChange={(event) =>{  setDraft(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') navigate(draft)
          }}
        />
        <button className="zdsh-wb-tab" onClick={() =>{  navigate(draft) }}>{t('go')}</button>
        {currentUrl !== null ? (
          <button className="zdsh-wb-tab" title={t('openInSystemBrowser')} onClick={() => window.open(currentUrl, '_blank')}>↗</button>
        ) : null}
      </div>

      {error !== null ? <div className="zdsh-wb-orphan">{error}</div> : null}

      <div style={{ flex: 1, position: 'relative', minHeight: 300 }}>
        {currentUrl === null ? (
          <div className="zdsh-wb-empty">{t('browseEmptyHint')}</div>
        ) : (
          <iframe
            key={`${String(active?.id)}:${currentUrl}`}
            src={currentUrl}
            sandbox=""
            referrerPolicy="no-referrer"
            allow=""
            style={{ width: '100%', height: '100%', border: '1px solid var(--zdsh-wb-border)', borderRadius: 6, background: '#fff' }}
          />
        )}
      </div>
    </div>
  )
}

function safeLabel(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname + (parsed.pathname === '/' ? '' : parsed.pathname.slice(0, 18))
  } catch {
    return url.slice(0, 20)
  }
}
