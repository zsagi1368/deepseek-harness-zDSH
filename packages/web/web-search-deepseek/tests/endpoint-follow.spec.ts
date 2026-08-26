/** Endpoint resolution for the DeepSeek search provider (#408): following the chat link's override. */

import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { SettingsProvider, settingsNamespace } from '@deepseek-ai/dsh-settings'
import WebRuntime from '@deepseek-ai/dsh-web'
import * as deepseekPlugin from '@deepseek-ai/dsh-web-search-deepseek'

/** The smallest real provider: one in-memory document, always writable. */
class MemorySettings extends SettingsProvider {
  doc: Record<string, unknown> = {}

  get writable(): boolean {
    return true
  }

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.doc))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.doc = { ...this.doc, [ns]: structuredClone(section) }
    return Promise.resolve()
  }
}

/** The chat adapter registers this namespace; the search plugin reads one field from it. */
const CHAT_NS = settingsNamespace('llm-deepseek')

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

/** The smallest Anthropic-shaped answer the provider accepts. */
const ONE_RESULT = {
  content: [
    { type: 'text', text: 'ok' },
    {
      type: 'web_search_tool_result',
      content: [{ type: 'web_search_result', url: 'https://a.test', title: 'A' }],
    },
  ],
}

async function boot(entry?: Record<string, unknown>): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(WebRuntime, {})
  const settingsFiber = ctx.plugin(MemorySettings)
  await settingsFiber.await()
  const pluginFiber = ctx.plugin(deepseekPlugin, { apiKey: 'ds-key', ...entry })
  await pluginFiber.await()
  return ctx
}

/** Run one search and return the endpoint the provider dispatched to. */
async function searchEndpoint(ctx: Context): Promise<string> {
  const fetchSpy = vi.spyOn(globalThis, 'fetch')
    .mockImplementation(() => Promise.resolve(jsonResponse(ONE_RESULT)))
  fetchSpy.mockClear()
  await ctx.web.search({ query: 'anything' })
  return String((fetchSpy.mock.calls.at(-1)?.[0] as URL | string | undefined) ?? '')
}

afterEach(() => {
  vi.restoreAllMocks()
  delete process.env.DEEPSEEK_SEARCH_BASE_URL
  delete process.env.DEEPSEEK_BASE_URL
})

describe('web-search-deepseek endpoint follows the chat override (#408)', () => {
  it('dispatches to the official Anthropic-compatible base when nothing overrides anywhere', async () => {
    const ctx = await boot()
    expect(await searchEndpoint(ctx)).toContain('https://api.deepseek.com/anthropic/v1')
    await ctx.fiber.dispose()
  })

  it('follows the chat adapter\'s configured baseURL when the chat gateway is explicit', async () => {
    const ctx = await boot()
    // Register the chat section the way llm-deepseek itself does.
    ctx.settings.register(CHAT_NS, z.object({ baseURL: z.string() }), {
      base: { baseURL: 'https://chat.gateway.test/v1' },
    })
    expect(await searchEndpoint(ctx)).toContain('https://chat.gateway.test/v1/messages')
    await ctx.fiber.dispose()
  })

  it('falls through to $DEEPSEEK_BASE_URL when the chat config carries no override', async () => {
    const ctx = await boot()
    ctx.settings.register(CHAT_NS, z.object({ baseURL: z.string() }), { base: {} })
    process.env.DEEPSEEK_BASE_URL = 'https://chat.env.test/v1'
    expect(await searchEndpoint(ctx)).toContain('https://chat.env.test/v1/messages')
    await ctx.fiber.dispose()
  })

  it('keeps the dedicated search variable above both chat overrides', async () => {
    const ctx = await boot()
    ctx.settings.register(CHAT_NS, z.object({ baseURL: z.string() }), {
      base: { baseURL: 'https://chat.gateway.test/v1' },
    })
    process.env.DEEPSEEK_BASE_URL = 'https://chat.env.test/v1'
    process.env.DEEPSEEK_SEARCH_BASE_URL = 'https://search.env.test/v1'
    expect(await searchEndpoint(ctx)).toContain('https://search.env.test/v1/messages')
    await ctx.fiber.dispose()
  })

  it('keeps the composition entry above every fallback', async () => {
    const ctx = await boot({ baseURL: 'https://search.entry.test/v1' })
    ctx.settings.register(CHAT_NS, z.object({ baseURL: z.string() }), {
      base: { baseURL: 'https://chat.gateway.test/v1' },
    })
    process.env.DEEPSEEK_SEARCH_BASE_URL = 'https://search.env.test/v1'
    expect(await searchEndpoint(ctx)).toContain('https://search.entry.test/v1/messages')
    await ctx.fiber.dispose()
  })

  it('ignores an empty chat environment value like an unset one', async () => {
    const ctx = await boot()
    process.env.DEEPSEEK_BASE_URL = ''
    expect(await searchEndpoint(ctx)).toContain('https://api.deepseek.com/anthropic/v1')
    await ctx.fiber.dispose()
  })
})
