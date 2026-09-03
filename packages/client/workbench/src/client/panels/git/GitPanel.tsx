import { useCallback, useEffect, useState } from 'react'
import type { ApiClient } from '../../api.ts'
import { useWorkbenchT } from '../../shell/context.ts'

interface StatusEntry {
  path: string
  x: string
  y: string
  untracked: boolean
}

interface StatusResult {
  branch: string
  ahead: number
  behind: number
  entries: StatusEntry[]
}

/**
 * The Git center panel: branch pill, change list with inline diff preview,
 * stage/unstage, Ctrl/Cmd+Enter commit, history, and confirmed-only network
 * actions (fetch/pull/push always preview before acting).
 */
export function GitPanel(props: { api: ApiClient; root: string }): React.ReactNode {
  const t = useWorkbenchT()
  const { api, root } = props
  const [status, setStatus] = useState<StatusResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<{ path: string; cached: boolean } | null>(null)
  const [diffText, setDiffText] = useState('')
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState<Array<{ hash: string; author: string; subject: string }> | null>(null)
  const [netlog, setNetlog] = useState('')

  const refresh = useCallback(async (): Promise<StatusResult | null> => {
    if (root === '') {
      setError('先在「文件」面板设置工作区根目录')
      return null
    }
    try {
      const result = await api.call<StatusResult>('git.status', { cwd: root })
      setStatus(result)
      setError(null)
      return result
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return null
    }
  }, [api, root])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const abs = (rel: string): string => root.replace(/[\\/]+$/, '') + '/' + rel

  async function showDiff(entry: StatusEntry): Promise<void> {
    if (!status) return
    const cached = entry.y !== ' ' && entry.y !== '?' && !(entry.x === '?' && entry.y === '?') && entry.x !== ' '
    const target = { path: entry.path, cached: !cached && entry.x !== ' ' ? false : cached }
    const chosenCached = entry.x !== ' ' && entry.y === ' ' ? true : cached
    void target
    try {
      const value = await api.call<string>(
        chosenCached ? 'git.diffCached' : 'git.diff',
        { cwd: root, path: abs(entry.path) },
      )
      setDiffText(value)
      setSelected({ path: entry.path, cached: chosenCached })
    } catch (cause) {
      setDiffText('')
      setSelected(null)
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function stage(paths: string[]): Promise<void> {
    setBusy(true)
    try {
      await api.call('git.stage', { cwd: root, paths: paths.map(abs) })
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function unstage(paths: string[]): Promise<void> {
    setBusy(true)
    try {
      await api.call('git.unstage', { cwd: root, paths: paths.map(abs) })
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function commit(): Promise<void> {
    if (message.trim() === '') return
    setBusy(true)
    try {
      await api.call('git.commit', { cwd: root, message: message.trim() })
      setMessage('')
      setSelected(null)
      setDiffText('')
      const next = await refresh()
      if (next !== null) void loadHistory(next.branch)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  async function loadHistory(_branch?: string): Promise<void> {
    try {
      const commits = await api.call<Array<{ hash: string; author: string; subject: string }>>('git.log', { cwd: root, limit: 30 })
      setHistory(commits)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function network(action: 'fetch' | 'pull' | 'push'): Promise<void> {
    try {
      const preview = await api.call<{ requiresConfirmation: boolean; tracking: string; remotes: string }>('git.' + action, { cwd: root })
      if (!preview.requiresConfirmation) return
      const detail = `${action} → ${preview.tracking || '(无上游)'}\n\n${preview.remotes}`
      if (window.confirm(`确认执行？\n${detail}`)) {
        setBusy(true)
        const done = await api.call<{ output: string }>('git.' + action, { cwd: root, remote: 'origin', confirm: true })
        setNetlog(done.output.slice(0, 2000))
        await refresh()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }

  const unstaged = status?.entries.filter(entry => !entry.untracked && (entry.y !== ' ' || entry.untracked)) ?? []
  const changes = status?.entries.filter(entry => entry.x === ' ' || entry.untracked || (entry.y !== ' ')) ?? []
  void unstaged

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        <span className="zdsh-wb-tab" style={{ background: 'var(--zdsh-wb-active)', fontWeight: 600 }}>
          ⎇ {status?.branch ?? '—'}
          {(status?.ahead ?? 0) > 0 || (status?.behind ?? 0) > 0
            ? ` ↑${String(status?.ahead ?? 0)} ↓${String(status?.behind ?? 0)}`
            : ''}
        </span>
        <button className="zdsh-wb-iconbtn" title={t('gitRefresh')} onClick={() => void refresh()}>⟳</button>
        <span style={{ flex: 1 }} />
        <button className="zdsh-wb-tab" disabled={busy} onClick={() => void network('fetch')}>{t('gitFetch')}</button>
        <button className="zdsh-wb-tab" disabled={busy} onClick={() => void network('pull')}>{t('gitPull')}</button>
        <button className="zdsh-wb-tab" disabled={busy} onClick={() => void network('push')}>{t('gitPush')}</button>
      </div>

      {error !== null ? <div className="zdsh-wb-orphan">{error}</div> : null}
      {root === '' ? <div className="zdsh-wb-empty">{t('gitNeedsRoot')}</div> : null}

      <textarea
        placeholder={t('commitPlaceholder')}
        value={message}
        onChange={(event) =>{  setMessage(event.target.value) }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') void commit()
        }}
        style={{ width: '100%', boxSizing: 'border-box', height: 44, background: 'transparent', color: 'inherit', border: '1px solid var(--zdsh-wb-border)', borderRadius: 6, padding: 6, font: 'inherit' }}
      />
      <div style={{ textAlign: 'right', margin: '4px 0 8px' }}>
        <button className="zdsh-wb-tab" disabled={busy || message.trim() === ''} onClick={() => void commit()}>{t('commit')}</button>
      </div>

      {changes.map(entry => (
        <div key={entry.path} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 4px' }}>
          <button
            className="zdsh-wb-menuitem"
            style={{ flex: 1, cursor: 'pointer' }}
            onClick={() => void showDiff(entry)}
            title={selected?.path === entry.path ? t('collapseDiff') : t('viewDiff')}
          >
            {selected?.path === entry.path ? '▼' : '▶'} {entry.untracked ? '?? ' : `${entry.x}${entry.y} `}
            {entry.path}
          </button>
          {entry.x === ' ' && entry.y !== ' ' && entry.y !== '?'
            ? <button className="zdsh-wb-iconbtn" title={t('unstage')} onClick={() => void unstage([entry.path])}>−</button>
            : null}
          {entry.x !== ' ' || entry.untracked
            ? <button className="zdsh-wb-iconbtn" title={t('stage')} onClick={() => void stage([entry.path])}>+</button>
            : null}
        </div>
      ))}

      {selected !== null && diffText !== '' ? (
        <pre style={{ background: 'var(--zdsh-wb-hover)', padding: 8, borderRadius: 6, overflow: 'auto', fontSize: 11, maxHeight: '40vh' }}>
          {diffText.split('\n').map((line, index) => (
            <div key={index} style={{
              color: line.startsWith('+') && !line.startsWith('+++') ? '#2ea043'
                : line.startsWith('-') && !line.startsWith('---') ? '#f85149'
                  : undefined,
              whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            }}>
              {line}
            </div>
          ))}
        </pre>
      ) : null}

      <div style={{ marginTop: 8 }}>
        <button
          className="zdsh-wb-menuitem"
          onClick={() => {
            if (history === null) void loadHistory(status?.branch)
            else setHistory(null)
          }}
        >
          {history === null ? t('historyShown') : t('historyHidden')}
        </button>
        {history?.map(commitItem => (
          <div key={commitItem.hash} className="zdsh-wb-menuitem" style={{ fontSize: 11, opacity: 0.85 }}>
            <code>{commitItem.hash}</code> {commitItem.subject}
          </div>
        ))}
      </div>

      {netlog !== '' ? (
        <pre style={{ fontSize: 10, opacity: 0.7, maxHeight: '20vh', overflow: 'auto' }}>{netlog}</pre>
      ) : null}
    </div>
  )
}
