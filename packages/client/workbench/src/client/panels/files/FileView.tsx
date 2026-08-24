import { useEffect, useState } from 'react'
import type { FsReadResult } from '../../../shared/fs-protocol.ts'
import { buildMediaUrl, getWorkspaceRoot } from '../../shell/workspace-root.ts'
import { pickViewKind } from './view-kind.ts'

/**
 * The file view panel body: dispatches on extension, renders a viewer, and
 * provides an MVP editor for text (CodeMirror upgrade lands in M7 polish).
 * Binary formats that need byte-range routes show an honest placeholder
 * until the media route lands.
 */
export function FileView(props: {
  api: import('../../api.ts').ApiClient
  path: string
}): React.ReactNode {
  const { api, path } = props
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; result: FsReadResult }>({ status: 'loading' })
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const kind = pickViewKind(path)

  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    setDraft(null)
    void api
      .call<FsReadResult>('fs.read', { cwd: getWorkspaceRoot(), path })
      .then((result) => {
        if (alive) setState({ status: 'ready', result })
      })
      .catch((cause: unknown) => {
        if (alive) setState({ status: 'error', message: cause instanceof Error ? cause.message : String(cause) })
      })
    return () => {
      alive = false
    }
  }, [api, path])

  async function save(): Promise<void> {
    if (draft === null) return
    setSaving(true)
    try {
      await api.call<unknown>('fs.write', { cwd: getWorkspaceRoot(), path, content: draft })
      setState({ status: 'ready', result: { kind: 'text', content: draft, truncated: false, size: draft.length } })
      setDraft(null)
    } finally {
      setSaving(false)
    }
  }

  if (state.status === 'loading') return <div style={{ opacity: 0.6 }}>加载中…</div>
  if (state.status === 'error') return <div className="zdsh-wb-orphan">{state.message}</div>

  const result = state.result

  if (result.kind === 'binary') {
    const media = buildMediaUrl(path)
    const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
    if (kind === 'image') {
      return (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            {name} <span style={{ opacity: 0.6, fontSize: 11 }}>({result.size} 字节)</span>
          </div>
          <img src={media} alt={name} style={{ maxWidth: '100%', borderRadius: 6, border: '1px solid var(--zdsh-wb-border)' }} />
        </div>
      )
    }
    if (kind === 'pdf') {
      return (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ flex: 1, fontSize: 12, opacity: 0.8 }}>{name}</span>
            <a className="zdsh-wb-tab" href={buildMediaUrl(path, true)} download={name}>下载</a>
          </div>
          <iframe title={name} src={media} style={{ width: '100%', height: '68vh', border: '1px solid var(--zdsh-wb-border)', borderRadius: 6 }} />
        </div>
      )
    }
    return (
      <div>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>{name}</div>
        <div className="zdsh-wb-orphan">
          二进制文件（{result.size} 字节），暂无内嵌渲染器。
          <a className="zdsh-wb-tab" href={media + '&download=1'} download={name}>下载文件</a>
        </div>
      </div>
    )
  }

  if (kind === 'html') {
    // Opaque-origin sandbox iframe: no allow-same-origin, no scripts beyond
    // what srcDoc permits inside the sandbox; referrer stripped.
    return (
      <iframe
        title={path}
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={result.content}
        style={{ width: '100%', height: '70vh', border: '1px solid var(--zdsh-wb-border)', borderRadius: 6 }}
      />
    )
  }

  const dirty = draft !== null && draft !== result.content
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <span style={{ flex: 1, wordBreak: 'break-all', fontSize: 12, opacity: 0.8 }}>{path}</span>
        <button
          className="zdsh-wb-tab"
          disabled={!dirty || saving}
          onClick={() => void save()}
          title="保存（Ctrl/Cmd+S）"
        >
          {saving ? '保存中…' : dirty ? '保存 *' : '已保存'}
        </button>
      </div>
      <textarea
        value={draft ?? result.content}
        readOnly={result.truncated}
        spellCheck={false}
        onChange={(event) =>{  setDraft(event.target.value) }}
        onKeyDown={(event) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
            event.preventDefault()
            void save()
          }
        }}
        style={{
          width: '100%',
          boxSizing: 'border-box',
          height: '62vh',
          fontFamily: 'ui-monospace, monospace',
          fontSize: 12,
          background: 'transparent',
          color: 'inherit',
          border: '1px solid var(--zdsh-wb-border)',
          borderRadius: 6,
          padding: 8,
          resize: 'vertical',
        }}
      />
      {result.truncated ? <div className="zdsh-wb-orphan">文件过大，只读显示前半部分。</div> : null}
      {kind === 'markdown' ? <div style={{ fontSize: 11, opacity: 0.6 }}>Markdown 渲染视图将在打磨里程碑接入。</div> : null}
    </div>
  )
}
