/** Text-file admission and content-addressed durable storage beside the image branch. */

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import {
  AttachmentError,
  AttachmentId,
} from '@deepseek-ai/dsh-attachment'
import { displayName, commitObjectFile, objectPath } from './store.ts'

/**
 * Default maximum bytes accepted for one submitted text file; oversized
 * sources are refused so one dropped document can never inflate every later
 * model request.
 */
export const DEFAULT_MAX_TEXT_BYTES = 256 * 1024

/**
 * File extensions admitted as text attachments by the intake whitelist. The
 * list is a UX filter for drag-and-drop surfaces, not a trust boundary: the
 * UTF-8 decode probe below remains the authority on whether bytes are text,
 * and unlisted names may still be stored programmatically.
 */
export const TEXT_FILE_EXTENSIONS: readonly string[] = Object.freeze([
  // Plain and marked-up prose.
  'txt', 'text', 'md', 'markdown', 'mdx', 'rst', 'adoc', 'org', 'tex', 'log',
  // Structured data and configuration.
  'json', 'jsonl', 'jsonc', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
  'properties', 'csv', 'tsv', 'xml', 'plist', 'sql', 'graphql',
  'proto', 'diff', 'patch',
  // Web and styling sources.
  'html', 'htm', 'css', 'scss', 'less', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx',
  'vue', 'svelte',
  // Systems and scripting languages.
  'py', 'pyi', 'rb', 'go', 'rs', 'java', 'kt', 'kts', 'scala', 'groovy', 'cs',
  'c', 'h', 'cpp', 'cc', 'cxx', 'hpp', 'hh', 'm', 'mm', 'swift', 'dart', 'php',
  'pl', 'pm', 'lua', 'r', 'jl', 'ex', 'exs', 'erl', 'hrl', 'clj', 'cljs', 'hs',
  'v', 'sv', 'zig', 'nim', 'sol', 'asm', 's',
  // Shells and build files.
  'sh', 'bash', 'zsh', 'fish', 'ps1', 'psm1', 'psd1', 'bat', 'cmd', 'mk',
  'cmake', 'gradle', 'bazel', 'bzl', 'nix', 'dockerfile', 'makefile',
  'gitignore', 'gitattributes', 'editorconfig', 'npmrc', 'babelrc',
])

/**
 * Exact leaf names admitted as text attachments regardless of extension.
 * Credential-bearing convention names (.env, *.pem) are deliberately absent:
 * dragging secrets into a model transcript is never the intended flow.
 */
export const TEXT_FILE_NAMES: readonly string[] = Object.freeze([
  'Makefile', 'Dockerfile', 'Justfile', 'Rakefile', 'Gemfile', 'Procfile',
  'LICENSE', 'LICENCE', 'NOTICE', 'README', 'CHANGELOG', 'CONTRIBUTING',
  'CODEOWNERS', '.gitignore', '.gitattributes', '.editorconfig', '.nvmrc',
])

/** C0 control characters that occur inside ordinary textual documents. */
const TEXT_CONTROL_CHARS = new Set(['\t', '\n', '\r', '\f', '\v', '\u001b'])

/** Admission limits for one submitted text file. */
export interface TextAttachmentLimits {
  /** Maximum accepted byte length; larger submissions are refused. */
  readonly maxBytes: number
}

/** Submitted text bytes with optional display metadata. */
export interface SaveTextAttachment {
  /** Raw file bytes, decoded by the caller from whatever transport carried them. */
  readonly data: Uint8Array
  /** Optional display name; never interpreted as a path. */
  readonly name?: string
}

/** Durable reference describing one stored text attachment. */
export interface TextAttachmentRef {
  /** Content-addressed identity (`sha256:` digest of the exact stored bytes). */
  readonly attachmentId: AttachmentId
  /** Fixed media type; stored text is always plain UTF-8 text. */
  readonly mediaType: 'text/plain'
  /** Exact stored byte count. */
  readonly bytes: number
  /** Unicode code-point count of the decoded text. */
  readonly chars: number
  /** Cleaned display name, when the submission carried a usable one. */
  readonly name?: string
}

/** Fully prepared text object, verified before publication. */
export interface PreparedTextFile {
  /** Deterministic original bytes whose digest is {@link ref.attachmentId}. */
  readonly data: Uint8Array
  /** Decoded text of {@link data}; text is stored verbatim, never normalized. */
  readonly text: string
  /** Durable reference describing {@link data}. */
  readonly ref: TextAttachmentRef
}

/** Stored text attachment read back with its verified bytes and text. */
export interface StoredTextAttachment {
  /** Reference recorded in the session log. */
  readonly ref: TextAttachmentRef
  /** Exact stored bytes. */
  readonly data: Uint8Array
  /** Decoded text of {@link data}. */
  readonly text: string
}

/** Caller-correctable text-admission failure codes raised before any storage work. */
export type TextAdmissionErrorCode = 'EMPTY_TEXT' | 'TEXT_TOO_LARGE' | 'TEXT_IS_BINARY'

/**
 * Content-admission failure for text attachments. Deliberately separate from
 * {@link AttachmentError}: its code union is closed over image and storage
 * codes owned by `@deepseek-ai/dsh-attachment`, and the wire routes on the
 * `code` string, not the prototype.
 */
export class TextAttachmentError extends Error {
  /** Stable machine-routing failure code. */
  readonly code: TextAdmissionErrorCode

  /**
   * @param message - human-readable failure description without raw bytes or host paths.
   * @param code - stable machine-routing code.
   * @param options - optional chained cause.
   */
  constructor(message: string, code: TextAdmissionErrorCode, options?: ErrorOptions) {
    super(message, options)
    this.name = 'TextAttachmentError'
    this.code = code
  }
}

function digest(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * Count Unicode code points without allocating an intermediate array.
 * @param text - decoded text to measure.
 * @returns the code-point total (each surrogate pair counts as one).
 */
function codePointCount(text: string): number {
  let count = text.length
  for (let index = 0; index < text.length - 1; index += 1) {
    const unit = text.charCodeAt(index)
    if (unit < 0xd800 || unit > 0xdbff) continue
    const next = text.charCodeAt(index + 1)
    if (next >= 0xdc00 && next <= 0xdfff) count -= 1
  }
  return count
}

/**
 * Decide whether one submitted display name passes the intake whitelist.
 * Matching is case-insensitive over the extension or the exact leaf name;
 * path separators have already been stripped by callers that clean names.
 * @param name - display name to test (a bare leaf, never a full path).
 * @returns whether the name looks like an admitted text document.
 */
export function isTextFileName(name: string): boolean {
  const leaf = name.replace(/[\u0000-\u001f\u007f]/g, '').trim()
  if (leaf === '') return false
  const lower = leaf.toLowerCase()
  if (TEXT_FILE_NAMES.some(candidate => candidate.toLowerCase() === lower)) return true
  const dot = lower.lastIndexOf('.')
  if (dot <= 0) return false
  return TEXT_FILE_EXTENSIONS.includes(lower.slice(dot + 1))
}

/**
 * Decode one candidate text payload, refusing binary content. The probe is
 * the acceptance authority and deliberately runs ahead of any declared-name
 * trust: a fatal UTF-8 decode proves the byte stream is text, and a control
 * character sweep rejects decodable-but-binary streams such as UTF-16 output
 * (whose interleaved NULs decode "successfully") before they reach storage.
 * @param data - raw candidate bytes.
 * @returns the decoded text.
 * @throws a {@link TextAttachmentError} when the bytes are empty or not plain text.
 */
export function decodeTextAttachment(data: Uint8Array): string {
  if (data.byteLength === 0) throw new TextAttachmentError('Text attachment is empty.', 'EMPTY_TEXT')
  let text: string
  try {
    // Fatal mode turns any malformed sequence into a throw instead of U+FFFD
    // replacement, so mojibake can never masquerade as admitted text.
    text = new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    throw new TextAttachmentError('Text attachment is not valid UTF-8 text.', 'TEXT_IS_BINARY')
  }
  for (const char of text) {
    if (char.charCodeAt(0) < 0x20 && !TEXT_CONTROL_CHARS.has(char)) {
      throw new TextAttachmentError('Text attachment contains binary control characters.', 'TEXT_IS_BINARY')
    }
    if (char === '\u007f') {
      throw new TextAttachmentError('Text attachment contains binary control characters.', 'TEXT_IS_BINARY')
    }
  }
  return text
}

/**
 * Run the full admission policy for one text file without touching storage:
 * the cheap byte cap first, then the UTF-8 decode probe as the binary gate.
 * @param input - submitted bytes and optional display name.
 * @param limits - resolved admission policy.
 * @returns completion once the payload is proven to be admissible text.
 */
export function validateTextFile(input: SaveTextAttachment, limits: TextAttachmentLimits): Promise<void> {
  if (!Number.isFinite(limits.maxBytes) || limits.maxBytes < 1) {
    return Promise.reject(new AttachmentError('Text byte limit must be a positive number.', 'INVALID_ATTACHMENT_REF'))
  }
  if (input.data.byteLength > limits.maxBytes) {
    return Promise.reject(new TextAttachmentError('Text exceeds the configured byte limit.', 'TEXT_TOO_LARGE'))
  }
  try {
    decodeTextAttachment(input.data)
  } catch (error: unknown) {
    // decodeTextAttachment only raises TextAttachmentError; the fallback keeps
    // the rejection reason an Error for non-Error surprises too.
    return Promise.reject(error instanceof Error
      ? error
      : new TextAttachmentError('Text is not admissible.', 'TEXT_IS_BINARY', { cause: error }))
  }
  return Promise.resolve()
}

/**
 * Decode, verify, and describe one submitted text file without touching storage.
 * @param input - submitted bytes and optional display name.
 * @param limits - admission policy.
 * @returns immutable reference facts beside bytes and text ready for atomic publication.
 */
export async function prepareTextFile(
  input: SaveTextAttachment,
  limits: TextAttachmentLimits,
): Promise<PreparedTextFile> {
  await validateTextFile(input, limits)
  const text = decodeTextAttachment(input.data)
  const sha256 = digest(input.data)
  const name = displayName(input.name)
  return {
    data: input.data,
    text,
    ref: {
      attachmentId: AttachmentId(`sha256:${sha256}`),
      mediaType: 'text/plain',
      bytes: input.data.byteLength,
      chars: codePointCount(text),
      ...(name !== undefined ? { name } : {}),
    },
  }
}

/**
 * Publish one already verified text object below a versioned attachment root.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param prepared - verified bytes, text, and reference.
 * @returns durable content-addressed text reference.
 */
export async function commitPreparedTextFile(root: string, prepared: PreparedTextFile): Promise<TextAttachmentRef> {
  const sha256 = String(prepared.ref.attachmentId).slice('sha256:'.length)
  if (!/^sha256:[a-f0-9]{64}$/u.test(String(prepared.ref.attachmentId))
    || digest(prepared.data) !== sha256
    || prepared.data.byteLength !== prepared.ref.bytes) {
    throw new AttachmentError('Prepared attachment bytes do not match their reference.', 'ATTACHMENT_CORRUPT')
  }
  await commitObjectFile(root, sha256, prepared.data)
  return prepared.ref
}

/**
 * Decode, verify, and publish one submitted text file.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param input - submitted bytes and optional display name.
 * @param limits - admission policy.
 * @returns durable content-addressed text reference.
 */
export async function saveTextFile(
  root: string,
  input: SaveTextAttachment,
  limits: TextAttachmentLimits,
): Promise<TextAttachmentRef> {
  return commitPreparedTextFile(root, await prepareTextFile(input, limits))
}

/**
 * Read and verify one content-addressed text attachment, returning its text.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param ref - reference recorded in the session log.
 * @param signal - optional cancellation for filesystem and verification work.
 * @returns verified bytes and decoded text.
 * @throws the signal reason when aborted, or an attachment error when verification fails.
 */
export async function readTextFile(
  root: string,
  ref: TextAttachmentRef,
  signal?: AbortSignal,
): Promise<StoredTextAttachment> {
  signal?.throwIfAborted()
  const match = /^sha256:([a-f0-9]{64})$/u.exec(String(ref.attachmentId))
  if (match?.[1] === undefined) throw new AttachmentError('Attachment reference is invalid.', 'INVALID_ATTACHMENT_REF')
  const sha256 = match[1]
  let data: Uint8Array
  try {
    data = new Uint8Array(await readFile(objectPath(root, sha256), { signal }))
  } catch (error) {
    signal?.throwIfAborted()
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      throw new AttachmentError('Attachment object is missing.', 'ATTACHMENT_NOT_FOUND')
    }
    throw new AttachmentError('Unable to read text attachment.', 'ATTACHMENT_READ_FAILED', { cause: error })
  }
  signal?.throwIfAborted()
  if (digest(data) !== sha256 || data.byteLength !== ref.bytes) {
    throw new AttachmentError('Stored attachment failed integrity verification.', 'ATTACHMENT_CORRUPT')
  }
  // Stored objects passed this same decode at admission; re-decoding also
  // re-proves the reference's char count without trusting persisted fields.
  const text = decodeTextAttachment(data)
  if (codePointCount(text) !== ref.chars) {
    throw new AttachmentError('Stored attachment metadata does not match its reference.', 'ATTACHMENT_CORRUPT')
  }
  return { ref, data, text }
}
