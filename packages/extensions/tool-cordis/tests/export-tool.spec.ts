/**
 * The cordis_export model face: preparation only, digest reporting, refusal
 * propagation, and the guarantee that no confirm verb exists as a Tool.
 */

import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import DynamicCordisRunnerService from '@deepseek-ai/dsh-cordis-host-runner'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRegistry from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { apply, inject, name } from '../src/index.ts'
import { presentExportCall } from '../src/present.ts'

const HOST = 'return { apply() {} }'

const AGENT_A = { id: 'S-a' as SessionId, steer() {}, inject() {} } as unknown as Agent

/** Export summaries observed on the event bus during one test. */
interface ObservedSummary {
  digests: { manifest: string; host: string }
}

/** One live tree: real registries, the runner on a private root, and this package's Tools. */
async function setup(): Promise<{
  ctx: Context
  runner: DynamicCordisRunnerService
  root: string
  cleanup: () => void
  exportSummaries: ObservedSummary[]
}> {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRegistry)
  const root = mkdtempSync(join(tmpdir(), 'export-tool-'))
  await ctx.plugin(DynamicCordisRunnerService, { persistedPluginsRoot: root })
  const exportSummaries: ObservedSummary[] = []
  ctx.on('cordis/request-export', summary => exportSummaries.push(summary as ObservedSummary))
  await ctx.plugin({ name, inject, apply })
  return {
    ctx,
    runner: ctx.dynamicCordisRunner,
    root,
    cleanup: () => { rmSync(root, { recursive: true, force: true }) },
    exportSummaries,
  }
}

/** Dispatch one Tool call through the real registry pipeline, as the agent loop would. */
function call(ctx: Context, tool: string, args: unknown): Promise<ToolExecutionResult> {
  return ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId(`call-${Math.random()}`),
    name: tool,
    arguments: args,
    agent: AGENT_A,
  })
}

/** Concatenated text blocks of one tool result. */
function text(result: ToolExecutionResult): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('cordis_export tool face', () => {
  it('prepares a request and reports digests without touching disk', async () => {
    const { ctx, runner, root, cleanup, exportSummaries } = await setup()
    try {
      const defined = runner.define({
        sessionId: AGENT_A.id,
        plugin: { kind: 'new', idPrefix: 'keep' },
        name: 'keeper',
        purpose: 'outlive the process',
        code: { host: HOST },
      })
      await expect(runner.run(AGENT_A, defined.pluginId, defined.packageId, 'run')).resolves.toMatchObject({ ok: true })

      const result = await call(ctx, 'cordis_export', {
        pluginId: String(defined.pluginId),
        packageId: String(defined.packageId),
      })
      expect(result.isError).toBe(false)
      const rendered = text(result)
      expect(rendered).toMatch(/Nothing was written yet/)
      expect(rendered).toMatch(/user must confirm/)
      // Digest prefixes shown to the user must match the emitted request summary.
      const announced = exportSummaries.at(-1)
      expect(announced).toBeDefined()
      expect(rendered).toContain((announced?.digests.manifest ?? '').slice(0, 12))
      expect(existsSync(root) ? readdirSync(root) : []).toEqual([])
    } finally {
      cleanup()
    }
  })

  it('propagates refusals as tool errors and never exposes a confirm verb', async () => {
    const { ctx, cleanup } = await setup()
    try {
      const failed = await call(ctx, 'cordis_export', { pluginId: 'ghost-9', packageId: 'pkg-404' })
      expect(failed.isError).toBe(true)
      expect(text(failed)).toMatch(/no dynamic plugin "ghost-9"/)

      for (const registered of ['confirmDynamicExport', 'rejectDynamicExport', 'cordis_confirm', 'cordis_persist']) {
        expect(ctx.tools.get(registered)).toBeUndefined()
      }
    } finally {
      cleanup()
    }
  })

  it('keeps the presenter an intent view that cannot read as success', () => {
    const view = presentExportCall({ pluginId: 'keep-1', packageId: 'pkg-2' })
    expect(view.kind).toBe('execute')
    expect(view.title).toMatch(/awaits user confirmation/)
  })
})
