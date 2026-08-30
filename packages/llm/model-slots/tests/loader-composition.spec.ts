import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import SessionStore from '@deepseek-ai/dsh-session'
import ModelSlotRegistry, { MODEL_SLOT_TITLE } from '../src/index.ts'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

async function loadYaml(lines: readonly string[]): Promise<Context> {
  root = await mkdtemp(join(tmpdir(), 'dsh-model-slots-loader-'))
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, [...lines, ''].join('\n'))

  context = new Context()
  context.baseUrl = pathToFileURL(root).href + '/'
  await context.plugin(Loader)
  context.loader.builtins.include = Include
  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-session', SessionStore],
    ['@deepseek-ai/dsh-model-slots', ModelSlotRegistry],
  ])
  context.loader.internal = {
    version: 'v2',
    async import(specifier: string) {
      if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
      return modules.get(specifier)
    },
  } as unknown as NonNullable<typeof context.loader.internal>
  await context.loader.create({
    name: 'cordis:include',
    config: { path: pathToFileURL(configPath).href },
  })
  await context.loader.await()
  return context
}

describe('real Loader composition', () => {
  it('loads the shipped model-slots YAML row and serves the configured slot', async () => {
    const loaded = await loadYaml([
      "- name: '@deepseek-ai/dsh-session'",
      "- name: '@deepseek-ai/dsh-model-slots'",
      '  config:',
      '    slots:',
      '      title:',
      '        provider: aux-provider',
      '        model: aux-model',
    ])

    const unloaded = [...loaded.loader.entries()]
      .filter(entry => entry.fiber === undefined && !entry.disabled)
      .map(entry => entry.options.name)
    expect(unloaded).toEqual([])
    expect(loaded.get('modelSlots')).toBeInstanceOf(ModelSlotRegistry)
    expect(loaded.get('modelSlots')?.resolve(MODEL_SLOT_TITLE)).toEqual({
      slot: MODEL_SLOT_TITLE,
      provider: 'aux-provider',
      model: 'aux-model',
      source: 'slot',
    })
  })

  it('rejects stale model-slots config after Schemastery normalization', async () => {
    context = new Context()
    await expect(context.plugin(ModelSlotRegistry, {
      route: { provider: 'a', model: 'b' },
    } as never)).rejects.toThrow(/unknown config key "route"/)
  })

  it('rejects an unknown slot id during direct construction', () => {
    expect(() => new ModelSlotRegistry(new Context(), {
      slots: { nope: { provider: 'a', model: 'b' } },
    })).toThrow(/unknown slot "nope"/)
  })
})
