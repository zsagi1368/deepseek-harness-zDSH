/** Shared workspace-root persistence (the explorer's choice drives git/terminal/view). */

const KEY = 'zdsh.workbench.explorer.root'

/**
 * Read the persisted workspace root.
 * @returns the stored root path, or '' when unset or unavailable.
 */
export function getWorkspaceRoot(): string {
  try {
    const value = window.localStorage.getItem(KEY)
    return typeof value === 'string' && value !== '' ? value : ''
  } catch {
    return ''
  }
}

/**
 * Persist the workspace root (no-op under privacy modes).
 * @param root - the root path to store.
 */
export function setWorkspaceRoot(root: string): void {
  try {
    window.localStorage.setItem(KEY, root)
  } catch {
    // In-memory only under privacy modes.
  }
}

/**
 * Build the /workbench/file URL for one workspace file.
 * @param path - the absolute path of the file.
 * @param download - when true, the URL carries the download flag.
 * @returns the media route URL with cwd and path query params.
 */
export function buildMediaUrl(path: string, download?: boolean): string {
  const params = new URLSearchParams({ cwd: getWorkspaceRoot(), path })
  if (download === true) params.set('download', '1')
  return `/workbench/file?${params.toString()}`
}
