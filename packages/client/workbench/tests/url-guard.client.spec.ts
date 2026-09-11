import { describe, expect, it } from 'vitest'
import { judgeUrl } from '../src/client/panels/browse/url-guard.ts'

describe('browser url guard', () => {
  it('accepts http(s) public urls and suggests https for bare domains', () => {
    expect(judgeUrl('https://example.com/page')).toEqual({ allowed: true, url: 'https://example.com/page' })
    const suggested = judgeUrl('example.com')
    expect(suggested.allowed).toBe(true)
    if (suggested.allowed) expect(suggested.url).toBe('https://example.com/')
  })

  it('refuses scripting and local-content schemes outright', () => {
    for (const evil of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'file:///C:/x', 'blob:https://a/b', 'about:blank']) {
      const verdict = judgeUrl(evil)
      expect(verdict).toMatchObject({ allowed: false })
      if (!verdict.allowed) expect(verdict.code).toBe('scheme-refused')
    }
  })

  it('refuses loopback, private ranges, link-local and mDNS names', () => {
    for (const host of [
      'http://localhost:3000',
      'http://127.0.0.1/x',
      'http://10.0.0.5/',
      'http://192.168.1.1/',
      'http://172.16.0.9/',
      'http://172.31.255.1/',
      'http://169.254.1.2/',
      'http://printer.local/',
      'http://[::1]/',
      'http://[fe80::1]/',
    ]) {
      const verdict = judgeUrl(host)
      expect(verdict).toMatchObject({ allowed: false })
      if (!verdict.allowed) expect(verdict.code).toBe('host-refused')
    }
  })

  it('keeps public-looking hosts that merely contain digits', () => {
    expect(judgeUrl('https://1723.example.com/').allowed).toBe(true)
    expect(judgeUrl('https://example.localhosting.invalid/').allowed).toBe(true)
  })

  it('rejects embedded credentials and unparseable input', () => {
    expect(judgeUrl('https://user:pass@example.com/')).toMatchObject({ allowed: false, code: 'bad-url' })
    expect(judgeUrl('   ')).toMatchObject({ allowed: false, code: 'bad-url' })
  })
})
