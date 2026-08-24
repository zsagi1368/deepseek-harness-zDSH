/** Pure dispatch from a file path to its preview strategy. */
export type ViewKind = 'markdown' | 'image' | 'pdf' | 'html' | 'text'

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'avif'])

export function pickViewKind(path: string): ViewKind {
  const dot = path.lastIndexOf('.')
  const ext = dot === -1 ? '' : path.slice(dot + 1).toLowerCase()
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'html' || ext === 'htm') return 'html'
  return 'text'
}
