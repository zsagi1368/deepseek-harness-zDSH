import { useEffect, useState, useSyncExternalStore } from 'react'
import { useWorkbenchT } from '../../shell/context.ts'
import { sortEntries } from './explorer-model.ts'
import type { ExplorerModel } from './explorer-model.ts'
import type { FsEntry } from '../../../shared/fs-protocol.ts'

/**
 * The file explorer panel: workspace root picker, breadcrumb navigation,
 * lazy tree with per-directory refresh, name search, and click-through to
 * the shared file view panel.
 */
export function Explorer(props: { model: ExplorerModel; onOpenFile: (path: string) => void }): React.ReactNode {
  const { model, onOpenFile } = props
  const t = useWorkbenchT()
  useSyncExternalStore(
    listener => model.subscribe(listener),
    () => model.selected, // re-render on any mutation; cheap reads below
  )
  const [rootDraft, setRootDraft] = useState(model.root)
  const [searchDraft, setSearchDraft] = useState('')
  const [searchResults, setSearchResults] = useState<Array<{ path: string; isDir: boolean }> | null>(null)

  // Re-render on every model notify (selected is only one of many fields;
  // subscribe via a counter so any change rerenders).
  const [, force] = useState(0)
  useEffect(() => model.subscribe(() =>{  force(value => value + 1) }), [model])

  useEffect(() => {
    if (model.root === '' && rootDraft !== '') void handleOpen()
  }, [])

  async function handleOpen(): Promise<void> {
    setSearchResults(null)
    await model.openRoot(rootDraft)
  }

  async function runSearch(): Promise<void> {
    try {
      const response = await model.search(searchDraft)
      setSearchResults(response.matches)
    } catch {
      setSearchResults([])
    }
  }

  function renderEntry(entry: FsEntry, depth: number): React.ReactNode {
    const expanded = model.expanded.has(entry.path)
    return (
      <div key={entry.path}>
        <div
          style={{
            display: 'flex', alignItems: 'center', gap: 4,
            padding: '2px 4px', paddingLeft: depth * 14 + 4,
            borderRadius: 5, cursor: 'pointer',
            background: model.selected === entry.path ? 'var(--zdsh-wb-active)' : undefined,
          }}
          onClick={() => {
            model.select(entry.path)
            if (entry.isDir) void model.toggleExpand(entry.path)
            else onOpenFile(entry.path)
          }}
        >
          {entry.isDir ? (
            <button className="zdsh-wb-iconbtn" style={{ padding: '0 3px', fontSize: 10 }} onClick={(event) => {
              event.stopPropagation()
              void model.toggleExpand(entry.path)
            }}>
              {expanded ? '▾' : '▸'}
            </button>
          ) : <span style={{ width: 17, textAlign: 'center' }}>{entry.broken ? '✗' : '·'}</span>}
          <span style={{ opacity: entry.broken ? 0.6 : 1 }}>{entry.name}</span>
        </div>
        {entry.isDir && expanded ? renderChildren(entry.path, depth + 1) : null}
      </div>
    )
  }

  function renderChildren(dir: string, depth: number): React.ReactNode {
    const entries = model.entriesOf(dir)
    if (entries === undefined) return <div style={{ paddingLeft: depth * 14 + 20, opacity: 0.5 }}>…</div>
    return sortEntries(entries).map(entry => renderEntry(entry, depth))
  }

  const crumbs = model.cwd === '' ? [] : model.cwd.split(/[/\\]+/).filter(Boolean)

  return (
    <div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
        <input
          style={{ flex: 1, minWidth: 0 }}
          placeholder={t('workspaceRootPlaceholder')}
          value={rootDraft}
          onChange={(event) =>{  setRootDraft(event.target.value) }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void handleOpen()
          }}
        />
        <button className="zdsh-wb-tab" onClick={() => void handleOpen()}>{t('open')}</button>
      </div>

      {model.root !== '' ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', fontSize: 12, opacity: 0.85 }}>
            <button className="zdsh-wb-iconbtn" title={t('goUp')} onClick={() =>{  model.up() }} disabled={model.cwd === model.root}>↑</button>
            <button className="zdsh-wb-iconbtn" title={t('refresh')} onClick={() => void model.loadDir(model.cwd, { force: true })}>⟳</button>
            <span style={{ wordBreak: 'break-all' }}>{crumbs.length > 0 ? crumbs.join(' / ') : model.cwd}</span>
          </div>

          <div style={{ display: 'flex', gap: 4, margin: '6px 0' }}>
            <input
              style={{ flex: 1, minWidth: 0 }}
              placeholder={t('searchPlaceholder')}
              value={searchDraft}
              onChange={(event) =>{  setSearchDraft(event.target.value) }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void runSearch()
              }}
            />
            <button className="zdsh-wb-tab" onClick={() => void runSearch()}>{t('search')}</button>
            {searchResults !== null ? <button className="zdsh-wb-tab" onClick={() =>{  setSearchResults(null) }}>{t('cancel')}</button> : null}
          </div>

          {model.error !== null ? <div className="zdsh-wb-orphan">{model.error}</div> : null}
          {model.loadingDir !== null ? <div style={{ opacity: 0.6 }}>{t('loading')}</div> : null}

          {searchResults !== null ? (
            searchResults.length === 0
              ? <div className="zdsh-wb-orphan">{t('noMatches')}</div>
              : searchResults.map(match => (
                <div
                  key={match.path}
                  className="zdsh-wb-menuitem"
                  style={{ cursor: 'pointer', wordBreak: 'break-all' }}
                  onClick={() => {
                    if (match.isDir) {
                      void model.openRoot(match.path)
                    } else {
                      onOpenFile(match.path)
                    }
                  }}
                >
                  {match.isDir ? '📁 ' : '· '}
                  {match.path}
                </div>
              ))
          ) : (
            renderChildren(model.cwd === '' ? model.root : model.cwd, 0) ?? null
          )}
          {model.isTruncated(model.cwd) ? <div className="zdsh-wb-orphan">{t('truncatedEntries')}</div> : null}
        </>
      ) : (
        <div className="zdsh-wb-empty">{t('filesEmptyHint')}</div>
      )}
    </div>
  )
}
