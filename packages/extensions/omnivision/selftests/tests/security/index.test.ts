/**
 * Tests for Security Utilities
 */
import { describe, it, expect } from 'vitest'
import { isPrivateOrReserved, redactSecrets, redactUrl } from '../../src/security/index.ts'

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
})
