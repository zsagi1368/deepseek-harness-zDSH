import { describe, expect, it } from 'vitest'
import { assertTrustedAuthorityEntry, isTrustedRequestHost } from '../src/trust.ts'

const headers = (host: string | undefined) => ({ host }) as Parameters<typeof isTrustedRequestHost>[0]

describe('workbench trust fence', () => {
  it('passes loopback hostnames on any port', () => {
    expect(isTrustedRequestHost(headers('localhost:4567'), [])).toBe(true)
    expect(isTrustedRequestHost(headers('127.0.0.1'), [])).toBe(true)
    expect(isTrustedRequestHost(headers('[::1]:8080'), [])).toBe(true)
    expect(isTrustedRequestHost(headers('LOCALHOST'), [])).toBe(true)
  })

  it('rejects missing, empty, or unparsable host headers', () => {
    expect(isTrustedRequestHost(headers(undefined), ['example.com'])).toBe(false)
    expect(isTrustedRequestHost(headers(''), ['example.com'])).toBe(false)
  })

  it('rejects non-loopback hosts when no trusted entries are configured', () => {
    expect(isTrustedRequestHost(headers('evil.example.com:8080'), [])).toBe(false)
    expect(isTrustedRequestHost(headers('192.168.1.10:3000'), [])).toBe(false)
  })

  it('admits a configured authority in exact canonical form', () => {
    expect(isTrustedRequestHost(headers('lab.internal:3000'), ['lab.internal:3000'])).toBe(true)
    expect(isTrustedRequestHost(headers('LAB.INTERNAL:3000'), ['lab.internal:3000'])).toBe(true)
  })

  it('does not let a portless entry grant every port', () => {
    expect(isTrustedRequestHost(headers('lab.internal:9999'), ['lab.internal'])).toBe(false)
    expect(isTrustedRequestHost(headers('lab.internal'), ['lab.internal'])).toBe(true)
  })

  it('rejects lookalike hosts that only share a suffix', () => {
    expect(isTrustedRequestHost(headers('evillab.internal:3000'), ['lab.internal:3000'])).toBe(false)
    expect(isTrustedRequestHost(headers('lab.internal.evil.com'), ['lab.internal'])).toBe(false)
  })

  it('refuses malformed configured entries loudly at load time', () => {
    expect(() =>{  assertTrustedAuthorityEntry('harness.internal/path') }).toThrow(/not a bare host/)
    expect(() =>{  assertTrustedAuthorityEntry('user@harness.internal') }).toThrow(/not a bare host/)
    expect(() =>{  assertTrustedAuthorityEntry(' lab.internal ') }).toThrow(/not a bare host/)
    expect(() =>{  assertTrustedAuthorityEntry('lab.internal:') }).toThrow(/not a bare host/)
    expect(() =>{  assertTrustedAuthorityEntry('lab.internal:03000') }).toThrow(/not a bare host/)
    expect(() =>{  assertTrustedAuthorityEntry('lab.internal:3000') }).not.toThrow()
  })
})
