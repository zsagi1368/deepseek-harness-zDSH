/**
 * Self-contained client utilities shared by the FileHub upload surfaces.
 * Everything here is dependency-free on purpose: the queue module (which must
 * stay unit-testable with zero DOM) imports only the pure helpers.
 */

/** UI copy language. Detected once from the browser locale; zh wins for zh-*. */
export type Lang = 'zh' | 'en'

/** A piece of user-facing copy in both supported languages. */
export interface Bilingual {
  readonly en: string
  readonly zh: string
}

/**
 * Detect the UI language once from a browser-like locale.
 * @param navigatorLike - an object exposing `language` (defaults to global navigator).
 * @returns 'zh' for zh-* locales, else 'en'.
 */
export function detectLang(navigatorLike?: { language?: string | undefined }): Lang {
  const source = navigatorLike ?? (typeof navigator !== 'undefined' ? navigator : undefined)
  return /^zh\b|-zh/i.test(source?.language ?? '') ? 'zh' : 'en'
}

/**
 * Resolve a bilingual entry against a language.
 * @param text - the bilingual copy pair.
 * @param lang - the language to pick.
 * @returns the matching copy string.
 */
export function pick(text: Bilingual, lang: Lang): string {
  return text[lang]
}

/**
 * Human byte size: 1024-based units, one decimal max, trailing ".0" trimmed.
 * @param bytes - the byte count to format.
 * @returns e.g. '512 B', '1.5 MB'; '?' for non-finite or negative input.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '?'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB', 'PB']
  let value = bytes
  let unit = 'B'
  for (const next of units) {
    value /= 1024
    unit = next
    if (value < 1024) break
  }
  const rounded = Math.round(value * 10) / 10
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
  return `${text} ${unit}`
}

/**
 * Last path segment after either separator; empty-safe.
 * @param path - the path to take the basename of.
 * @returns the trailing segment (whole input when no separator).
 */
export function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(index + 1) : normalized
}

/**
 * Normalize a client-side relative path into the wire form expected by the
 * `x-file-relpath` header: forward slashes, no leading "./", no leading or
 * trailing slash. Does NOT sanitize hostile names — that authority stays with
 * the server (P01 §9 FR-F2).
 * @param input - the raw client-supplied relative path.
 * @returns the wire-form path ('' for empty/dot results).
 */
export function normalizeRelativePath(input: string): string {
  let path = input.replace(/\\/g, '/').trim()
  while (path.startsWith('./')) path = path.slice(2)
  if (path === '.' || path === '..') return ''
  return path.replace(/^\/+|\/+$/g, '')
}

let styleInjected = false

/**
 * Install the plugin's scoped stylesheet once per document. All FileHub
 * classes carry the `zdsh-filehub-` prefix and live under element-scoped
 * selectors; no host-private class names are referenced (they are hash-named
 * and break across versions).
 * @param id - the style element id (also the once-guard key).
 * @param css - the stylesheet text to install.
 */
export function injectStylesOnce(id: string, css: string): void {
  if (styleInjected || typeof document === 'undefined') return
  if (document.getElementById(id) !== null) {
    styleInjected = true
    return
  }
  const tag = document.createElement('style')
  tag.id = id
  tag.textContent = css
  document.head.appendChild(tag)
  styleInjected = true
}
