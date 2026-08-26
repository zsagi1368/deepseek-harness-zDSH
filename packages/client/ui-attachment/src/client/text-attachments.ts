/** Client-side text-file intake: whitelist, UTF-8 probe, and draft-segment
 * bookkeeping. Browser twin of the admission rules enforced again by the
 * durable attachment backend; text dropped here rides the composer draft, so
 * sending carries it as one text content block headed by the file name. */

/**
 * Maximum bytes accepted for one dropped text file. Mirrors the durable
 * backend's default cap: a document that cannot be stored later must not
 * enter the draft now.
 */
export const DRAFT_TEXT_MAX_BYTES = 256 * 1024

/**
 * File extensions admitted as text drafts (the drag-and-drop UX filter; see
 * the storage-side `TEXT_FILE_EXTENSIONS` for the twin list and its trust
 * rationale).
 */
export const DRAFT_TEXT_EXTENSIONS: readonly string[] = Object.freeze([
  'txt', 'text', 'md', 'markdown', 'mdx', 'rst', 'adoc', 'org', 'tex', 'log',
  'json', 'jsonl', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'properties', 'csv', 'tsv', 'xml', 'plist', 'sql', 'graphql',
  'proto', 'diff', 'patch',
  'html', 'htm', 'css', 'scss', 'less', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx',
  'vue', 'svelte',
  'py', 'pyi', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'groovy', 'cs',
  'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'm', 'mm', 'swift', 'dart', 'php',
  'pl', 'pm', 'lua', 'r', 'jl', 'ex', 'exs', 'erl', 'hrl', 'clj', 'cljs', 'hs',
  'v', 'sv', 'zig', 'nim', 'sol', 'asm', 's',
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'psd1', 'bat', 'cmd', 'mk',
  'cmake', 'gradle', 'bazel', 'bzl', 'nix', 'dockerfile', 'makefile',
  'gitignore', 'gitattributes', 'editorconfig', 'npmrc', 'babelrc',
])

/**
 * Exact leaf names admitted regardless of extension. Credential convention
 * names (.env, *.pem) stay absent on purpose.
 */
export const DRAFT_TEXT_NAMES: readonly string[] = Object.freeze([
  'Makefile', 'Dockerfile', 'Justfile', 'Rakefile', 'Gemfile', 'Procfile',
  'LICENSE', 'LICENCE', 'NOTICE', 'README', 'CHANGELOG', 'CONTRIBUTING',
  'CODEOWNERS', '.gitignore', '.gitattributes', '.editorconfig', '.nvmrc',
])

/** C0 control characters that occur inside ordinary textual documents. */
const TEXT_CONTROL_CHARS = new Set(['\t', '\n', '\r', '\f', '\v', '\u001b'])

/**
 * Decide whether a browser-reported name passes the intake whitelist.
 * @param name - display name as the browser reports it (a leaf name).
 * @returns whether the extension or exact leaf name is whitelisted.
 */
export function isDraftTextName(name: string): boolean {
  const leaf = name.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (leaf === '') return false
  const lower = leaf.toLowerCase()
  if (DRAFT_TEXT_NAMES.some(candidate => candidate.toLowerCase() === lower)) return true
  const dot = lower.lastIndexOf('.')
  if (dot <= 0) return false
  return DRAFT_TEXT_EXTENSIONS.includes(lower.slice(dot + 1))
}

/**
 * Split a dropped batch into text candidates and everything else by the
 * browser-declared type first, then the name whitelist. A `text/*` MIME wins
 * over an unlisted extension; anything image-like stays with the image path.
 * @param file - dropped browser file.
 * @returns whether this plugin owns the file's intake.
 */
export function isDraftTextFile(file: { readonly name: string; readonly type: string }): boolean {
  if (file.type.startsWith('text/')) return true
  return !file.type.startsWith('image/') && isDraftTextName(file.name)
}

/**
 * Decode candidate bytes as plain text or refuse them. The fatal UTF-8 decode
 * is the binary gate ahead of any name trust; a control-character sweep then
 * rejects decodable-but-binary streams such as UTF-16 output whose
 * interleaved NUL characters would otherwise decode "successfully".
 * @param data - raw candidate bytes.
 * @returns the decoded text.
 * @throws a RangeError from the decoder, or an Error naming the offending
 * control shape, when the payload is not plain text.
 */
export function decodeDraftText(data: Uint8Array): string {
  const text = new TextDecoder('utf-8', { fatal: true }).decode(data)
  for (const char of text) {
    if ((char.charCodeAt(0) < 0x20 && !TEXT_CONTROL_CHARS.has(char)) || char === '\u007f') {
      throw new Error('draft text contains binary control characters')
    }
  }
  return text
}

/**
 * Render one accepted file as the draft segment that will ride the message.
 * @param name - cleaned display name heading the segment.
 * @param text - decoded file content.
 * @returns the verbatim `[name]\n<content>` block, newline-terminated.
 */
export function draftTextSegment(name: string, text: string): string {
  const body = text === '' || text.endsWith('\n') ? text : `${text}\n`
  return `[${name}]\n${body}`
}

/**
 * Append one segment to the current draft with a blank-line separator.
 * @param draft - the machine's current full draft.
 * @param segment - newline-terminated segment from {@link draftTextSegment}.
 * @returns the next full draft.
 */
export function appendDraftSegment(draft: string, segment: string): string {
  if (draft === '') return segment
  const separator = draft.endsWith('\n\n') ? '' : draft.endsWith('\n') ? '\n' : '\n\n'
  return `${draft}${separator}${segment}`
}

/**
 * Remove one still-contiguous segment from the draft, swallowing one blank
 * line of separator before it. Drafts edited past exact containment keep
 * their text; the card alone goes away.
 * @param draft - the machine's current full draft.
 * @param segment - the exact segment previously appended.
 * @returns the next draft and whether any text was removed.
 */
export function removeDraftSegment(draft: string, segment: string): { draft: string; removed: boolean } {
  const at = draft.indexOf(segment)
  if (at < 0) return { draft, removed: false }
  const before = draft.slice(0, at)
  const swallow = before.endsWith('\n\n') ? 2 : before.endsWith('\n') ? 1 : 0
  return { draft: draft.slice(0, at - swallow) + draft.slice(at + segment.length), removed: true }
}
