/** Shared workspace-root persistence (the explorer's choice drives git/terminal/view). */

const KEY = 'zdsh.workbench.explorer.root'

export function getWorkspaceRoot(): string {
  try {
    const value = window.localStorage.getItem(KEY)
    return typeof value === 'string' && value !== '' ? value : ''
  } catch {
    return ''
  }
}

export function setWorkspaceRoot(root: string): void {
  try {
    window.localStorage.setItem(KEY, root)
  } catch {
    // In-memory only under privacy modes.
  }
}

export function buildMediaUrl(path: string, download?: boolean): string {
  const params = new URLSearchParams({ cwd: getWorkspaceRoot(), path })
  if (download === true) params.set('download', '1')
  return `/workbench/file?${params.toString()}`
}
