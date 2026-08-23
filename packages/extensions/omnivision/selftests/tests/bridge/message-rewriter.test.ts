/**
 * Tests for Message Rewriter
 */
import { describe, it, expect } from 'vitest'
import { rewriteMessage, createTextMarker, extractDescriptions, sanitizeForDeepSeek } from '../../src/bridge/message-rewriter.ts'
import type { ImageAttachment, VisionDescription } from '../../src/config/types.ts'

describe('MessageRewriter', () => {
  const mockImage: ImageAttachment = {
    path: '/test/image.png',
    contentHash: 'abc123',
    mime: 'image/png',
    bytes: 1024,
  }

  const mockDescription: VisionDescription = {
    summary: 'This is a test description',
    ocr: 'OCR text here',
  }

  it('should return unchanged message when no images', () => {
    const result = rewriteMessage('Hello world', [], [])
    expect(result.content).toBe('Hello world')
    expect(result.role).toBe('user')
  })

  it('should append description markers for single image', () => {
    const result = rewriteMessage('What is this?', [mockImage], [mockDescription])

    expect(result.content).toContain('[已识图1:')
    expect(result.content).toContain('This is a test description')
    expect(result.content).toContain('OCR text here')
  })

  it('should handle multiple images', () => {
    const desc2: VisionDescription = { summary: 'Second image description' }
    const img2: ImageAttachment = { ...mockImage, contentHash: 'def456' }

    const result = rewriteMessage('Compare these', [mockImage, img2], [mockDescription, desc2])

    expect(result.content).toContain('[已识图1:')
    expect(result.content).toContain('[已识图2:')
    expect(result.content).toContain('This is a test description')
    expect(result.content).toContain('Second image description')
  })

  it('should create text marker', () => {
    const marker = createTextMarker(mockDescription, 1)
    expect(marker).toBe('[已识图1: This is a test description]')
  })

  it('should extract descriptions from content', () => {
    const content = 'Question?\n\n[已识图1: Summary one]\n\n[已识图2: Summary two]'
    const descriptions = extractDescriptions(content)

    expect(descriptions).toHaveLength(2)
    expect(descriptions[0].summary).toBe('Summary one')
    expect(descriptions[1].summary).toBe('Summary two')
  })

  it('should sanitize __vision__ markers', () => {
    const content = 'Question\n\n[__vision__: summary text]\n[__vision__: tool hints]'
    const sanitized = sanitizeForDeepSeek(content)

    expect(sanitized).not.toContain('__vision__')
    expect(sanitized).toContain('Question')
  })
})
