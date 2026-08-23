/**
 * Tests for Security Utilities
 */
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { isPrivateOrReserved, redactSecrets, redactUrl } from '../../../src/security/index.ts'
import { assertReadableImagePath, resolveAllowedRoots } from '../../../src/vision/providers.ts'

describe('Security Utils', () => {
  describe('isPrivateOrReserved', () => {
    it('should detect private IPv4 addresses', () => {
      expect(isPrivateOrReserved('10.0.0.1')).toBe(true)
      expect(isPrivateOrReserved('192.168.1.1')).toBe(true)
      expect(isPrivateOrReserved('172.16.0.1')).toBe(true)
      expect(isPrivateOrReserved('127.0.0.1')).toBe(true)
    })

    it('should detect public IPv4 addresses', () => {
      expect(isPrivateOrReserved('8.8.8.8')).toBe(false)
      expect(isPrivateOrReserved('1.1.1.1')).toBe(false)
    })

    it('should detect private IPv6 addresses', () => {
      expect(isPrivateOrReserved('::1')).toBe(true)
      expect(isPrivateOrReserved('fe80::1')).toBe(true)
      expect(isPrivateOrReserved('fc00::1')).toBe(true)
    })

    it('should judge IPv4-mapped IPv6 by its embedded address', () => {
      // The mapped form must not bypass the v4 ranges.
      expect(isPrivateOrReserved('::ffff:10.0.0.5')).toBe(true)
      expect(isPrivateOrReserved('::ffff:192.168.1.1')).toBe(true)
      expect(isPrivateOrReserved('::ffff:127.0.0.1')).toBe(true)
      expect(isPrivateOrReserved('::ffff:8.8.8.8')).toBe(false)
    })

    it('should detect the full CGNAT range 100.64.0.0/10', () => {
      expect(isPrivateOrReserved('100.64.0.1')).toBe(true)
      expect(isPrivateOrReserved('100.100.0.1')).toBe(true)
      expect(isPrivateOrReserved('100.127.255.254')).toBe(true)
      // Outside the /10: not carrier-grade NAT space.
      expect(isPrivateOrReserved('100.128.0.1')).toBe(false)
      expect(isPrivateOrReserved('100.63.255.255')).toBe(false)
    })
  })

  describe('redactSecrets', () => {
    it('should redact known secrets', () => {
      const text = 'Use key abc123secret456 for auth'
      const result = redactSecrets(text, ['abc123secret456'])
      expect(result).toBe('Use key [REDACTED] for auth')
    })

    it('should redact token shapes', () => {
      const text = 'Token: sk-abc123def456ghi789jkl012mno345pqr'
      const result = redactSecrets(text, [])
      expect(result).toContain('[REDACTED_KEY]')
    })

    it('should redact URL credentials', () => {
      const text = 'URL: https://user:pass@example.com'
      const result = redactSecrets(text, [])
      expect(result).toBe('URL: https://***:***@example.com')
    })
  })

  describe('redactUrl', () => {
    it('should redact URL userinfo', () => {
      const url = 'https://apikey:sk-123@api.example.com/v1'
      const result = redactUrl(url)
      expect(result).toContain('***:***')
      expect(result).not.toContain('sk-123')
    })

    it('should return unchanged URL without credentials', () => {
      const url = 'https://api.example.com/v1'
      const result = redactUrl(url)
      expect(result).toBe(url)
    })
  })

  describe('assertReadableImagePath', () => {
    it('admits real files inside temp roots and caller-declared roots', () => {
      const root = mkdtempSync(join(tmpdir(), 'omni-path-'))
      writeFileSync(join(root, 'probe.png'), 'png')
      expect(assertReadableImagePath(join(root, 'probe.png'), [root])).toBe(
        join(root, 'probe.png'),
      )
      // Temp locations are admitted without extra declarations.
      expect(resolveAllowedRoots()).toContain(resolve(tmpdir()))
    })

    it('rejects paths outside every allowed root', () => {
      expect(() => assertReadableImagePath('/etc/passwd')).toThrow('PATH_DENIED')
    })

    it('compares at segment boundaries, so /tmp does not admit /tmpx', () => {
      // resolve('/tmpx/evil.png') sits beside — not inside — the '/tmp' root.
      expect(() => assertReadableImagePath('/tmpx/evil.png')).toThrow('PATH_DENIED')
    })

    it('fails closed when the final component is missing or a directory', () => {
      const root = mkdtempSync(join(tmpdir(), 'omni-path-missing-'))
      expect(() => assertReadableImagePath(join(root, 'nope.png'), [root])).toThrow('PATH_DENIED')
      expect(() => assertReadableImagePath(root, [root])).toThrow('PATH_DENIED')
    })
  })
})
