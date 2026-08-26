import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, rm } from 'node:fs/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { AttachmentError, AttachmentId } from '@deepseek-ai/dsh-attachment'
import {
  commitPreparedTextFile, decodeTextAttachment, DEFAULT_MAX_TEXT_BYTES, isTextFileName, prepareTextFile,
  readTextFile, saveTextFile, TEXT_FILE_EXTENSIONS, TEXT_FILE_NAMES, validateTextFile,
} from '../src/text.ts'
import { TextAttachmentError } from '../src/text.ts'

const LIMITS = { maxBytes: 1024 }

const roots: string[] = []

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'dsh-text-attachment-'))
  roots.push(value)
  return join(value, 'attachments', 'v1')
}

function bytes(text: string): Uint8Array {
  return Uint8Array.from(Buffer.from(text, 'utf8'))
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

describe('text attachment admission', () => {
  it('admits whitelisted extensions and exact names case-insensitively', () => {
    expect(TEXT_FILE_EXTENSIONS.length).toBeGreaterThan(40)
    expect(isTextFileName('notes.txt')).toBe(true)
    expect(isTextFileName('README.TXT')).toBe(true)
    expect(isTextFileName('server.TS')).toBe(true)
    expect(isTextFileName('Makefile')).toBe(true)
    expect(isTextFileName('makefile')).toBe(true)
    expect(isTextFileName('.gitignore')).toBe(true)
    expect(isTextFileName('.editorconfig')).toBe(true)
    for (const name of ['archive.zip', 'photo.png', 'image.svg', 'app.exe', 'data.bin', '', 'gitignore', '.env', '.pem']) {
      expect(isTextFileName(name)).toBe(false)
    }
  })

  it('lists credential convention names on purpose', () => {
    const lower = TEXT_FILE_NAMES.map(name => name.toLowerCase())
    expect(lower).not.toContain('.env')
    expect(lower).not.toContain('.pem')
  })

  it('decodes UTF-8 payloads and refuses binary look-alikes', () => {
    expect(decodeTextAttachment(bytes('hello\nworld\r\n你好'))).toBe('hello\nworld\r\n你好')
    // A lone trailing cut of a multi-byte sequence must not decode lossily.
    expect(() => decodeTextAttachment(Uint8Array.from([0x61, 0xe4, 0xbd]))).toThrow(TextAttachmentError)
    expect(() => decodeTextAttachment(Uint8Array.from([0xff, 0xfe]))).toThrow(TextAttachmentError)
    // NUL bytes decode "successfully" but mark binary content (UTF-16 output).
    expect(() => decodeTextAttachment(Uint8Array.from([0x61, 0x00, 0x62]))).toThrow(TextAttachmentError)
    // Other C0 controls are refused; ordinary whitespace and ANSI escapes pass.
    expect(() => decodeTextAttachment(Uint8Array.of(0x01))).toThrow(TextAttachmentError)
    expect(decodeTextAttachment(Uint8Array.of(0x09, 0x0a, 0x0d, 0x0c, 0x0b, 0x1b, 0x5b, 0x30, 0x6d))).toBe('\t\n\r\f\v\x1b[0m')
  })

  it('validates emptiness and the byte cap ahead of the decode probe', async () => {
    await expect(validateTextFile({ data: bytes('') }, LIMITS)).rejects.toMatchObject({ code: 'EMPTY_TEXT' })
    await expect(validateTextFile({ data: bytes('a'.repeat(1025)) }, LIMITS))
      .rejects.toMatchObject({ code: 'TEXT_TOO_LARGE' })
    // Oversize is refused before the probe can spend effort on the payload.
    const binary = new Uint8Array(1025)
    binary[0] = 0xff
    await expect(validateTextFile({ data: binary }, LIMITS)).rejects.toMatchObject({ code: 'TEXT_TOO_LARGE' })
    await expect(validateTextFile({ data: bytes('ok') }, LIMITS)).resolves.toBeUndefined()
    await expect(validateTextFile({ data: bytes('ok') }, { maxBytes: 0 })).rejects.toBeInstanceOf(AttachmentError)
  })

  it('prepares a reference addressed by the exact submitted bytes', async () => {
    const data = bytes('# title\nbody')
    const prepared = await prepareTextFile({ data, name: String.raw`C:\Users\z\notes.md` }, LIMITS)
    expect(prepared.text).toBe('# title\nbody')
    expect(prepared.ref.attachmentId).toBe(AttachmentId(`sha256:${createHash('sha256').update(data).digest('hex')}`))
    expect(prepared.ref.mediaType).toBe('text/plain')
    expect(prepared.ref.bytes).toBe(data.byteLength)
    expect(prepared.ref.chars).toBe(12)
    expect(prepared.ref.name).toBe('notes.md')
    await expect(prepareTextFile({ data }, LIMITS)).resolves.toEqual({
      ...prepared,
      ref: { ...prepared.ref, name: undefined },
    })
  })

  it('counts astral code points as one char each', async () => {
    const prepared = await prepareTextFile({ data: bytes('"😀"') }, LIMITS)
    expect(prepared.ref.chars).toBe(3)
    expect(prepared.text.length).toBe(4)
  })
})

describe('text attachment storage', () => {
  it('saves, reads back verbatim, and dedupes by content address', async () => {
    const storageRoot = await root()
    const input = { data: bytes('export const answer = 42\n'), name: 'answer.ts' }
    const ref = await saveTextFile(storageRoot, input, LIMITS)
    const stored = await readTextFile(storageRoot, ref)
    expect(stored.text).toBe('export const answer = 42\n')
    expect(new TextDecoder().decode(stored.data)).toBe('export const answer = 42\n')
    const objectPath = join(storageRoot, 'objects', String(ref.attachmentId).slice(7, 9), String(ref.attachmentId).slice(7))
    expect(new TextDecoder().decode(await readFile(objectPath))).toBe('export const answer = 42\n')
    const again = await saveTextFile(storageRoot, input, LIMITS)
    expect(again).toEqual(ref)
  })

  it('refuses commits whose bytes do not match their reference', async () => {
    const storageRoot = await root()
    const prepared = await prepareTextFile({ data: bytes('truth'), name: 'a.txt' }, LIMITS)
    const forged = { ...prepared, data: bytes('lies') }
    await expect(commitPreparedTextFile(storageRoot, forged)).rejects.toMatchObject({ code: 'ATTACHMENT_CORRUPT' })
    const malformed = {
      ...prepared,
      ref: { ...prepared.ref, attachmentId: AttachmentId(`sha256:${'z'.repeat(64)}`) },
    }
    await expect(commitPreparedTextFile(storageRoot, malformed)).rejects.toMatchObject({ code: 'ATTACHMENT_CORRUPT' })
  })

  it('reports missing objects and corrupted or tampered references on read', async () => {
    const storageRoot = await root()
    const ref = (await saveTextFile(storageRoot, { data: bytes('keep'), name: 'k.txt' }, LIMITS))
    await expect(readTextFile(storageRoot, {
      ...ref,
      attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`),
    })).rejects.toMatchObject({ code: 'ATTACHMENT_NOT_FOUND' })
    await expect(readTextFile(storageRoot, { ...ref, bytes: ref.bytes + 1 }))
      .rejects.toMatchObject({ code: 'ATTACHMENT_CORRUPT' })
    await expect(readTextFile(storageRoot, { ...ref, chars: ref.chars + 1 }))
      .rejects.toMatchObject({ code: 'ATTACHMENT_CORRUPT' })
    await expect(readTextFile(storageRoot, { ...ref, attachmentId: AttachmentId('not-a-digest') }))
      .rejects.toMatchObject({ code: 'INVALID_ATTACHMENT_REF' })
  })

  it('honours cancellation between phases', async () => {
    const storageRoot = await root()
    const controller = new AbortController()
    controller.abort()
    const ref = await saveTextFile(storageRoot, { data: bytes('x'), name: 'x.txt' }, LIMITS)
    await expect(readTextFile(storageRoot, ref, controller.signal)).rejects.toBeInstanceOf(Error)
  })
})

describe('default text limits', () => {
  it('keeps the documented cap', () => {
    expect(DEFAULT_MAX_TEXT_BYTES).toBe(256 * 1024)
  })
})
