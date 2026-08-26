// @vitest-environment jsdom
/** Client-side text intake rules: whitelist, UTF-8 probe, and the draft
 * segment bookkeeping that keeps filename cards honest about their spans. */

import { describe, expect, it } from 'vitest'
import {
  appendDraftSegment, decodeDraftText, DRAFT_TEXT_MAX_BYTES, DRAFT_TEXT_NAMES, draftTextSegment,
  isDraftTextFile, isDraftTextName, removeDraftSegment,
} from '../src/client/text-attachments.ts'

function bytes(...values: number[]): Uint8Array {
  return Uint8Array.of(...values)
}

describe('draft text whitelist', () => {
  it('admits whitelisted extensions and exact leaf names', () => {
    expect(isDraftTextName('a/b/c/notes.md')).toBe(true)
    expect(isDraftTextName('Makefile')).toBe(true)
    expect(isDraftTextName('.gitignore')).toBe(true)
  })

  it('refuses unlisted or credential-convention names', () => {
    for (const name of ['archive.zip', 'photo.png', 'app.exe', '', 'gitignore', '.env', '.pem']) {
      expect(isDraftTextName(name)).toBe(false)
    }
    const lower = DRAFT_TEXT_NAMES.map(name => name.toLowerCase())
    expect(lower).not.toContain('.env')
  })

  it('routes by declared type first: text/* wins, image/* stays with images', () => {
    expect(isDraftTextFile({ name: 'blob.dat', type: 'text/plain' })).toBe(true)
    expect(isDraftTextFile({ name: 'notes.md', type: '' })).toBe(true)
    expect(isDraftTextFile({ name: 'photo.png', type: 'image/png' })).toBe(false)
    expect(isDraftTextFile({ name: 'clip.svg', type: 'image/svg+xml' })).toBe(false)
    expect(isDraftTextFile({ name: 'movie.mp4', type: 'video/mp4' })).toBe(false)
  })
})

describe('draft text probe', () => {
  it('decodes ordinary UTF-8 including CJK and ANSI-coloured logs', () => {
    const payload = new TextEncoder().encode('line1\n你好\x1b[0m\tend')
    expect(decodeDraftText(payload)).toBe('line1\n你好\x1b[0m\tend')
  })

  it('refuses malformed UTF-8 and binary control shapes', () => {
    expect(() => decodeDraftText(bytes(0xff, 0xfe))).toThrow()
    // A cut multi-byte tail must not survive as replacement characters.
    expect(() => decodeDraftText(bytes(0x61, 0xe4, 0xbd))).toThrow()
    // UTF-16 output decodes "successfully" but its NULs betray it.
    expect(() => decodeDraftText(bytes(0x61, 0x00, 0x62, 0x00))).toThrow(/control/)
  })
})

describe('draft segment bookkeeping', () => {
  it('heads every segment with the file name and a newline-terminated body', () => {
    expect(draftTextSegment('a.txt', 'one\ntwo')).toBe('[a.txt]\none\ntwo\n')
    expect(draftTextSegment('empty.txt', '')).toBe('[empty.txt]\n')
    expect(draftTextSegment('ends.txt', 'kept\n')).toBe('[ends.txt]\nkept\n')
  })

  it('appends with a blank-line separator into empty and non-empty drafts', () => {
    const segment = draftTextSegment('a.txt', 'body')
    expect(appendDraftSegment('', segment)).toBe(segment)
    expect(appendDraftSegment('hello', segment)).toBe(`hello\n\n${segment}`)
    expect(appendDraftSegment('hello\n', segment)).toBe(`hello\n\n${segment}`)
    expect(appendDraftSegment('hello\n\n', segment)).toBe(`hello\n\n${segment}`)
  })

  it('removes an untouched span with one separator line and reports misses', () => {
    const segment = draftTextSegment('a.txt', 'body')
    const full = appendDraftSegment('hello', segment)
    expect(removeDraftSegment(full, segment)).toEqual({ draft: 'hello', removed: true })
    // A mid-draft card keeps the following paragraph; one blank line of
    // separator goes with the removed span.
    const middle = `before\n\n${segment}\nafter`
    expect(removeDraftSegment(middle, segment)).toEqual({ draft: 'before\nafter', removed: true })
    // An edited draft keeps its text; only the card goes away.
    expect(removeDraftSegment('edited beyond recognition', segment))
      .toEqual({ draft: 'edited beyond recognition', removed: false })
  })
})

describe('draft text cap', () => {
  it('matches the durable backend default', () => {
    expect(DRAFT_TEXT_MAX_BYTES).toBe(256 * 1024)
  })
})
