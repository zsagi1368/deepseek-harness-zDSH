/**
 * Provider implementations for DSH Omnivision
 */
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { VisionExecuteOptions, VisionFailure, VisionResult } from '../config/types.js'
import { assertSafeRemoteTarget, isPathWithinRoots, isPlainFileAt } from '../security/index.js'
import type { VisionProvider } from './provider.js'

const MAX_FILE_SIZE = 25 * 1024 * 1024 // 25MB
// Local image reads are admitted only from temp locations or caller-declared
// roots (the plugin's workspace), compared at path-segment boundaries.
const BASE_ALLOWED_ROOTS = ['/tmp', '/private/tmp']

/** Effective readable roots for one execute call: base temp roots + extras. */
export function resolveAllowedRoots(allowedPaths?: readonly string[]): string[] {
  return [...BASE_ALLOWED_ROOTS, tmpdir(), ...(allowedPaths ?? [])].map(root => resolve(root))
}

/**
 * Validate one local image path against the allowed roots before reading.
 *
 * - segment-boundary containment (never a raw string prefix, so `/tmp` does
 *   not admit `/tmpx`, and Windows paths resolve like any other);
 * - best-effort TOCTOU re-check: `lstat` of the final component right before
 *   the read; symlinks/directories/devices are rejected (residual race window
 *   between check and open remains — see isPlainFileAt).
 */
export function assertReadableImagePath(path: string, allowedPaths?: readonly string[]): string {
  const resolved = resolve(path)
  if (!isPathWithinRoots(resolved, resolveAllowedRoots(allowedPaths))) {
    throw new Error('PATH_DENIED')
  }
  if (!isPlainFileAt(resolved)) throw new Error('PATH_DENIED')
  return resolved
}

function buildFailureResponse(status: number, message: string, retryable = true): VisionResult {
  const kind: VisionFailure['kind'] =
    status === 401 || status === 403
      ? 'AUTH'
      : status === 429
        ? 'RATE_LIMIT'
        : status >= 500
          ? 'SERVER'
          : 'OTHER'
  return {
    ok: false,
    meta: { provider: 'unknown', model: 'unknown', durationMs: 0 },
    errors: [{ kind, code: `VISION_${status}`, message, retryable }],
  }
}

function detectMime(path: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? ''
  const mimeMap: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
  }
  return mimeMap[ext] ?? 'image/png'
}

function readFileAsBase64(path: string, allowedPaths?: readonly string[]): string {
  const resolved = assertReadableImagePath(path, allowedPaths)
  const buffer = readFileSync(resolved)
  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error('FILE_TOO_LARGE')
  }
  return buffer.toString('base64')
}

// OpenAI provider
export const openaiProvider: VisionProvider = {
  name: 'openai',
  defaultModel: 'gpt-4-vision-preview',
  category: 'api',
  speedClass: 'fast',
  async execute(options: VisionExecuteOptions): Promise<VisionResult> {
    const startTime = Date.now()
    try {
      await assertSafeRemoteTarget('https://api.openai.com')
      const contents: Array<{ type: string; text?: string; image_url?: { url: string } }> = []
      if (options.query) contents.push({ type: 'text', text: options.query })
      for (const img of options.images) {
        if (img.kind === 'local' && img.path) {
          const mime = img.mime || detectMime(img.path)
          const base64 = readFileAsBase64(img.path, options.allowedPaths)
          contents.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } })
        }
      }
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: 'gpt-4-vision-preview',
          messages: [{ role: 'user', content: contents }],
        }),
        signal: options.signal ?? null,
        redirect: 'manual',
      })
      if (!response.ok) return buildFailureResponse(response.status, 'API_ERROR')
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content: string } }>
        model?: string
      }
      const text = data.choices?.[0]?.message?.content ?? ''
      return {
        ok: true,
        data: { summary: text },
        meta: { provider: 'openai', model: 'gpt-4', durationMs: Date.now() - startTime },
      }
    } catch (_error) {
      return buildFailureResponse(0, 'API_ERROR')
    }
  },
}

// Anthropic provider
export const anthropicProvider: VisionProvider = {
  name: 'anthropic',
  defaultModel: 'claude-3-5-sonnet-20241022',
  category: 'api',
  speedClass: 'fast',
  async execute(options: VisionExecuteOptions): Promise<VisionResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return buildFailureResponse(0, 'AUTH_MISSING')
    const startTime = Date.now()
    try {
      await assertSafeRemoteTarget('https://api.anthropic.com')
      const content: Array<{
        type: string
        text?: string
        source?: { type: string; media_type: string; data: string }
      }> = []
      if (options.query) content.push({ type: 'text', text: options.query })
      for (const img of options.images) {
        if (img.kind === 'local' && img.path) {
          const mime = img.mime || detectMime(img.path)
          content.push({
            type: 'image',
            source: { type: 'base64', media_type: mime, data: readFileAsBase64(img.path, options.allowedPaths) },
          })
        }
      }
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 4096,
          messages: [{ role: 'user', content }],
        }),
        signal: options.signal ?? null,
        redirect: 'manual',
      })
      if (!response.ok) return buildFailureResponse(response.status, 'API_ERROR')
      const data = (await response.json()) as {
        content?: Array<{ type: string; text?: string }>
        model?: string
      }
      const text = data.content?.find(c => c.type === 'text')?.text ?? ''
      return {
        ok: true,
        data: { summary: text },
        meta: { provider: 'anthropic', model: 'claude-3-5', durationMs: Date.now() - startTime },
      }
    } catch (_error) {
      return buildFailureResponse(0, 'API_ERROR')
    }
  },
}

// Gemini provider
export const geminiProvider: VisionProvider = {
  name: 'gemini',
  defaultModel: 'gemini-1.5-flash',
  category: 'api',
  speedClass: 'fast',
  async execute(options: VisionExecuteOptions): Promise<VisionResult> {
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return buildFailureResponse(0, 'AUTH_MISSING')
    const startTime = Date.now()
    try {
      await assertSafeRemoteTarget('https://generativelanguage.googleapis.com')
      const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = []
      if (options.query) parts.push({ text: options.query })
      for (const img of options.images) {
        if (img.kind === 'local' && img.path) {
          const mime = img.mime || detectMime(img.path)
          parts.push({ inlineData: { mimeType: mime, data: readFileAsBase64(img.path, options.allowedPaths) } })
        }
      }
      const response = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify({ contents: [{ role: 'user', parts }] }),
          signal: options.signal ?? null,
          redirect: 'manual',
        },
      )
      if (!response.ok) return buildFailureResponse(response.status, 'API_ERROR')
      const data = (await response.json()) as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      }
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
      return {
        ok: true,
        data: { summary: text },
        meta: { provider: 'gemini', model: 'gemini-1.5-flash', durationMs: Date.now() - startTime },
      }
    } catch (_error) {
      return buildFailureResponse(0, 'API_ERROR')
    }
  },
}

// OVHcloud free provider
export const ovhProvider: VisionProvider = {
  name: 'ovh-free',
  defaultModel: 'Qwen2.5-VL-72B-Instruct',
  category: 'free',
  speedClass: 'slow',
  async execute(options: VisionExecuteOptions): Promise<VisionResult> {
    const startTime = Date.now()
    try {
      await assertSafeRemoteTarget('https://oai.endpoints.kepler.ai.cloud.ovh.net')
      const contents: Array<{ type: string; text?: string; image_url?: { url: string } }> = []
      if (options.query) contents.push({ type: 'text', text: options.query })
      for (const img of options.images) {
        if (img.kind === 'local' && img.path) {
          const mime = img.mime || 'image/png'
          contents.push({
            type: 'image_url',
            image_url: { url: `data:${mime};base64,${readFileAsBase64(img.path, options.allowedPaths)}` },
          })
        }
      }
      const response = await fetch(
        'https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: 'Qwen2.5-VL-72B-Instruct',
            messages: [{ role: 'user', content: contents }],
          }),
          signal: options.signal ?? null,
          redirect: 'manual',
        },
      )
      if (!response.ok) {
        if (response.status === 429) return buildFailureResponse(429, 'RATE_LIMITED', true)
        return buildFailureResponse(response.status, 'API_ERROR')
      }
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content: string } }>
      }
      const text = data.choices?.[0]?.message?.content ?? ''
      return {
        ok: true,
        data: { summary: text },
        meta: { provider: 'ovh-free', model: 'Qwen2.5-VL-72B', durationMs: Date.now() - startTime },
      }
    } catch (_error) {
      return buildFailureResponse(0, 'NETWORK_ERROR', true)
    }
  },
}

// Zhipu provider
export const zhipuProvider: VisionProvider = {
  name: 'zhipu',
  defaultModel: 'glm-4.6v-flash',
  category: 'free',
  speedClass: 'fast',
  async execute(options: VisionExecuteOptions): Promise<VisionResult> {
    const apiKey = process.env.ZAI_API_KEY
    if (!apiKey) return buildFailureResponse(0, 'AUTH_MISSING')
    const startTime = Date.now()
    try {
      await assertSafeRemoteTarget('https://open.bigmodel.cn')
      const contents: Array<{ type: string; text?: string; image_url?: { url: string } }> = []
      if (options.query) contents.push({ type: 'text', text: options.query })
      for (const img of options.images) {
        if (img.kind === 'local' && img.path) {
          const mime = img.mime || 'image/png'
          contents.push({
            type: 'image_url',
            image_url: { url: `data:${mime};base64,${readFileAsBase64(img.path, options.allowedPaths)}` },
          })
        }
      }
      const response = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'glm-4.6v-flash',
          messages: [{ role: 'user', content: contents }],
        }),
        signal: options.signal ?? null,
        redirect: 'manual',
      })
      if (!response.ok) return buildFailureResponse(response.status, 'API_ERROR')
      const data = (await response.json()) as {
        choices?: Array<{ message?: { content: string } }>
      }
      const text = data.choices?.[0]?.message?.content ?? ''
      return {
        ok: true,
        data: { summary: text },
        meta: { provider: 'zhipu', model: 'glm-4.6v-flash', durationMs: Date.now() - startTime },
      }
    } catch (_error) {
      return buildFailureResponse(0, 'NETWORK_ERROR', true)
    }
  },
}
