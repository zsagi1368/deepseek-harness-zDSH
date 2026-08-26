import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
  type Agent as AcpAgent,
  type Client,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from '@agentclientprotocol/sdk'
import { Readable, Writable } from 'node:stream'
import { execa } from 'execa'
import { afterEach, describe, expect, it } from 'vitest'
import { LOADER_SMOKE_TEST_TIMEOUT_MS, resolveExampleLaunch } from '@deepseek-ai/dsh-loader-smoke'

/**
 * `dsh acp` entrypoint acceptance: the product launcher boots its standard
 * profile composition with the ACP bridge row on top, speaks the stdio
 * JSON-RPC handshake end to end against a mock-backed turn, keeps stdout
 * protocol-pure, and drains to exit code 0 when the client hangs up.
 */

const dshBinScript = fileURLToPath(new URL('../src/bin.ts', import.meta.url))
const tsconfigPath = fileURLToPath(new URL('../../../tsconfig.json', import.meta.url))
const libBin = fileURLToPath(new URL('../lib/bin.js', import.meta.url))

/** The scripted adapter the test profile inserts; one turn answers with this text. */
const MOCK_REPLY = 'ACP ENTRYPOINT OK'

const MOCK_ADAPTER_MJS = [
  "import { LlmAdapter } from '@deepseek-ai/dsh-llm'",
  'class Mock extends LlmAdapter {',
  '  async * stream() {',
  "    yield { type: 'block-start', index: 0, blockType: 'text' }",
  `    yield { type: 'text-delta', index: 0, text: ${JSON.stringify(MOCK_REPLY)} }`,
  `    yield { type: 'block-end', index: 0, block: { type: 'text', text: ${JSON.stringify(MOCK_REPLY)} } }`,
  "    yield { type: 'finish', reason: { kind: 'stop' } }",
  '  }',
  '}',
  "export const name = 'acp-entrypoint-mock'",
  "export const inject = ['llm']",
  "export function apply(ctx) { ctx.llm.registerAdapter(['acp-mock-provider'], new Mock()) }",
  '',
].join('\n')

/**
 * Pre-initialize the default `acp` profile the way first use would (base
 * bundle manifest plus empty user layer), then add the test-only hermeticity
 * layer: the mock adapter row and the title generators disabled so no stray
 * LLM call can consume the scripted response.
 */
async function makeHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), 'dsh-acp-entrypoint-'))
  const profileDir = join(home, 'profiles', 'acp')
  await mkdir(profileDir, { recursive: true })
  await writeFile(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-acp',
    private: true,
    dependencies: {},
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } },
  }, undefined, 2))
  await writeFile(join(profileDir, 'cordis.patch.yml'), [
    '- id: session-title',
    '  disabled: true',
    '- id: session-title-llm',
    '  disabled: true',
    '- insert:',
    '    - id: acp-entrypoint-mock-llm',
    "      name: './acp-entrypoint-mock.mjs'",
    '',
  ].join('\n'))
  await writeFile(join(profileDir, 'acp-entrypoint-mock.mjs'), MOCK_ADAPTER_MJS)
  return home
}

function launchEnv(home: string): NodeJS.ProcessEnv {
  return {
    DSH_HOME: home,
    DSH_AGENTS_HOME: join(home, '.agents'),
    DEEPSEEK_API_KEY: 'keyless-acp-entrypoint-no-call',
    DSH_TELEMETRY_DISABLED: '1',
  }
}

let child: ReturnType<typeof spawn> | undefined

afterEach(async () => {
  if (child !== undefined) {
    const proc = child
    child = undefined
    if (proc.exitCode === null && proc.signalCode === null) {
      const exited = new Promise<void>((resolve) => { proc.once('exit', () => { resolve() }) })
      proc.kill('SIGKILL')
      await exited
    }
  }
})

describe.skipIf(!existsSync(libBin))('dsh acp stdio entrypoint', () => {
  it('completes the ACP handshake over the standard composition, stays stdout-pure, and exits 0 on hang-up', async () => {
    const home = await makeHome()
    const sessionCwd = await mkdtemp(join(tmpdir(), 'dsh-acp-workspace-'))
    const launch = resolveExampleLaunch({
      srcBin: dshBinScript,
      configArgs: ['acp', '--provider', 'acp-mock-provider', '--model', 'acp-mock-model'],
      tsconfigPath,
      env: launchEnv(home),
    })
    child = spawn(launch.command, launch.args, {
      cwd: sessionCwd,
      env: { ...process.env, ...launch.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const stderr: string[] = []
    child.stderr!.setEncoding('utf8')
    child.stderr!.on('data', (chunk: string) => { stderr.push(chunk) })
    // Tee raw stdout for the protocol-purity check while feeding the SDK client.
    const rawOut: string[] = []
    const passthrough = new Readable({ read() {} })
    child.stdout!.on('data', (buf: Buffer) => { rawOut.push(buf.toString('utf8')); passthrough.push(buf) })
    child.stdout!.on('end', () => passthrough.push(null))
    const stream = ndJsonStream(
      Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(passthrough) as ReadableStream<Uint8Array>,
    )
    const updates: SessionNotification['update'][] = []
    const makeClient = (_agent: AcpAgent): Client => ({
      sessionUpdate(params: SessionNotification): Promise<void> {
        updates.push(params.update)
        return Promise.resolve()
      },
      requestPermission(_request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
        return Promise.resolve({ outcome: { outcome: 'cancelled' } })
      },
    })
    const client = new ClientSideConnection(makeClient, stream)

    const init = await client.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} })
    expect(init.protocolVersion).toBe(PROTOCOL_VERSION)
    expect(init.agentCapabilities).toMatchObject({ promptCapabilities: { image: false, audio: false } })

    const { sessionId } = await client.newSession({ cwd: sessionCwd, mcpServers: [] })
    expect(sessionId).toBeTypeOf('string')

    const result = await client.prompt({ sessionId, prompt: [{ type: 'text', text: 'reply' }] })
    expect(result.stopReason).toBe('end_turn')
    await expect.poll(() => updates).toEqual([
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: MOCK_REPLY } },
    ])

    // Protocol purity: every stdout byte belongs to a JSON-RPC frame — no
    // banner, progress line, or logger leak may share the stream.
    for (const line of rawOut.join('').split('\n').filter(line => line.trim().length > 0)) {
      expect(() => JSON.parse(line) as unknown).not.toThrow()
    }
    expect(stderr.join('')).not.toContain('without inject')

    // The client owns connection lifetime: hanging up drains the tree and
    // exits 0 without a signal.
    const exited = new Promise<number>((resolve, reject) => {
      child!.once('exit', (code) => { resolve(code ?? -1) })
      child!.once('error', reject)
    })
    child.stdin!.end()
    expect(await exited).toBe(0)
    child = undefined
  }, LOADER_SMOKE_TEST_TIMEOUT_MS)

  it('prints a config dump that includes the bridge row and exits without booting', async () => {
    const home = await makeHome()
    const launch = resolveExampleLaunch({
      srcBin: dshBinScript,
      configArgs: ['acp', '--dump-config'],
      tsconfigPath,
      env: launchEnv(home),
    })
    const result = await execa(launch.command, launch.args, {
      env: { ...process.env, ...launch.env },
      input: '',
      timeout: 25_000,
      killSignal: 'SIGKILL',
      reject: false,
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toContain('@deepseek-ai/dsh-acp')
    expect(result.stdout).toContain('id: acp')
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }, 30_000)

  it('omits the bridge layer from --dump-default-config like every other non-bundle layer', async () => {
    const home = await makeHome()
    const launch = resolveExampleLaunch({
      srcBin: dshBinScript,
      configArgs: ['acp', '--dump-default-config'],
      tsconfigPath,
      env: launchEnv(home),
    })
    const result = await execa(launch.command, launch.args, {
      env: { ...process.env, ...launch.env },
      input: '',
      timeout: 25_000,
      killSignal: 'SIGKILL',
      reject: false,
    })
    expect(result.exitCode).toBe(0)
    expect(result.stdout).not.toContain('@deepseek-ai/dsh-acp')
    await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }, 30_000)
})
