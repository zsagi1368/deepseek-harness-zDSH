/**
 * The --read-only deployment face: every mutation-class RPC answers the fixed
 * `read-only-mode` error at the gateway exit, every browse-safe row reaches
 * its implementation, and a proxy composed without the flag behaves exactly
 * like the baseline (no row ever answers the read-only code). The method
 * tables below enumerate the FULL RpcMethodMap key set on purpose: a method
 * added to an Api domain later fails this spec until it is classified, which
 * is the fail-closed contract of the guard.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import SessionStore from '@deepseek-ai/dsh-session'
import type { SessionId } from '@deepseek-ai/dsh-session'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { ApiProxy } from '../src/api/index.ts'
import type { GoalRef, WorkspaceId } from '../src/api/index.ts'
import type { RpcMethodMap } from '../src/api/rpc-map.ts'
import type { RpcRequest, RpcResponse } from '../src/api/rpc.ts'
import { RpcId } from '../src/api/rpc.ts'
import { createApiProxy } from '../src/api-proxy.ts'

const sid = (value: string): SessionId => value as SessionId
const wid = (value: string): WorkspaceId => value as WorkspaceId

/** Every wire method of the current map, verbatim from rpc-map.ts. */
const ALL_METHODS: readonly (keyof RpcMethodMap)[] = [
  'session.list',
  'session.search',
  'session.create',
  'session.history',
  'session.models',
  'session.selectModel',
  'session.rename',
  'session.fork',
  'session.prompt',
  'session.attachment',
  'session.updateQueue',
  'session.cancel',
  'subagent.list',
  'subagent.history',
  'subagent.prompt',
  'subagent.interrupt',
  'host.describe',
  'host.pickDirectory',
  'host.listDirectory',
  'host.createDirectory',
  'host.openPath',
  'host.revealPath',
  'workspace.list',
  'workspace.create',
  'workspace.rename',
  'workspace.delete',
  'workspace.insertBefore',
  'workspace.insertSessionBefore',
  'workspace.archiveSession',
  'skill.list',
  'agentPreset.list',
  'agentPreset.select',
  'agentPreset.read',
  'agentPreset.copy',
  'agentPreset.openDocument',
  'agentPreset.remove',
  'goal.create',
  'goal.edit',
  'goal.pause',
  'goal.resume',
  'goal.complete',
  'goal.clear',
  'settings.describe',
  'settings.openDocument',
  'settings.update',
  'settings.replace',
  'settings.mutate',
  'credentials.describe',
  'credentials.set',
  'credentials.unset',
  'llm.providers',
  'llm.models',
  'llm.discoverModels',
]

/**
 * The browse-safe classification mirrored from api-proxy.ts. Deliberately a
 * literal copy: if the source set drifts without this table following (or the
 * map grows a key), the parameterized specs below fail loudly.
 */
const BROWSE_SAFE: readonly (keyof RpcMethodMap)[] = [
  'session.list',
  'session.search',
  'session.history',
  'session.models',
  'session.attachment',
  'subagent.list',
  'subagent.history',
  'workspace.list',
  'skill.list',
  'agentPreset.list',
  'host.describe',
  'llm.providers',
  'llm.models',
]

/** Derived mutation set: everything the map defines minus the browse-safe rows. */
const MUTATION_METHODS = ALL_METHODS.filter(method => !BROWSE_SAFE.includes(method))

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`ro-${String(nextRpc++)}`), payload }
}

/** One compare-and-set goal identity for the goal.* mutation rows. */
const GOAL_REF: GoalRef = { id: 'g1' as GoalRef['id'], revision: 1 }

/** Wire name → the namespace invocation it reaches, payloads kept minimal. */
const CALLS: Readonly<
  Record<keyof RpcMethodMap, (api: ApiProxy, sessionId: SessionId) => Promise<RpcResponse<unknown>>>
> = {
  'session.list': api => api.sessions.list(request({})),
  'session.search': api => api.sessions.search(request({ query: 'needle' }), new AbortController().signal),
  'session.create': api => api.sessions.create(request({})),
  'session.history': (api, sessionId) => api.sessions.history(request({ sessionId })),
  'session.models': (api, sessionId) => api.sessions.models(request({ sessionId })),
  'session.selectModel': (api, sessionId) => api.sessions.selectModel(request({ sessionId, provider: 'p', model: 'm' })),
  'session.rename': (api, sessionId) => api.sessions.rename(request({ sessionId, title: 'renamed' })),
  'session.fork': (api, sessionId) => api.sessions.fork(request({ sessionId })),
  'session.prompt': (api, sessionId) => api.sessions.prompt(request({ sessionId, mode: 'queue', content: [{ type: 'text', text: 'hi' }] })),
  'session.attachment': (api, sessionId) => api.sessions.attachment(request({ sessionId, attachmentId: 'no-such-attachment' as never })),
  'session.updateQueue': (api, sessionId) => api.sessions.updateQueue(request({ sessionId, itemId: 'q1' as never, action: { kind: 'remove' } })),
  'session.cancel': (api, sessionId) => api.sessions.cancel(request({ sessionId })),
  'subagent.list': (api, sessionId) => api.subagents.list(request({ parentSessionId: sessionId }), new AbortController().signal),
  'subagent.history': (api, sessionId) => api.subagents.history(request({
    parentSessionId: sessionId,
    childSessionId: sessionId,
    mode: 'continuable',
  }), new AbortController().signal),
  'subagent.prompt': (api, sessionId) => api.subagents.prompt(
    request({ parentSessionId: sessionId, childSessionId: sessionId, mode: 'continuable', content: [{ type: 'text', text: 'hi' }] }),
    new AbortController().signal,
  ),
  'subagent.interrupt': (api, sessionId) => api.subagents.interrupt(
    request({ parentSessionId: sessionId, childSessionId: sessionId, mode: 'continuable' }),
  ),
  'host.describe': api => api.host.describe(request({})),
  'host.pickDirectory': api => api.host.pickDirectory(request({}), new AbortController().signal),
  'host.listDirectory': api => api.host.listDirectory(request({ path: '/tmp' }), new AbortController().signal),
  'host.createDirectory': api => api.host.createDirectory(request({ path: '/tmp/dsh-ro-spec', name: 'dsh-ro-spec' })),
  'host.openPath': api => api.host.openPath(request({ path: '/tmp' }), new AbortController().signal),
  'host.revealPath': api => api.host.revealPath(request({ path: '/tmp' }), new AbortController().signal),
  'workspace.list': api => api.workspace.list(request({})),
  'workspace.create': api => api.workspace.create(request({ path: '/tmp' })),
  'workspace.rename': api => api.workspace.rename(request({ workspaceId: wid('ws'), title: 't' })),
  'workspace.delete': api => api.workspace.delete(request({ workspaceId: wid('ws') })),
  'workspace.insertBefore': api => api.workspace.insertBefore(request({ workspaceId: wid('ws'), beforeWorkspaceId: wid('ws2') })),
  'workspace.insertSessionBefore': api => api.workspace.insertSessionBefore(
    request({ workspaceId: wid('ws'), sessionId: sid('s'), beforeSessionId: sid('s2') }),
  ),
  'workspace.archiveSession': api => api.workspace.archiveSession(request({ sessionId: sid('s') })),
  'skill.list': (api, sessionId) => api.skills.list(request({ sessionId })),
  'agentPreset.list': api => api.agentPresets.list(request({})),
  'agentPreset.select': (api, sessionId) => api.agentPresets.select(request({ sessionId, agentPreset: 'default' })),
  'agentPreset.read': api => api.agentPresets.read(request({ agentPreset: 'default' })),
  'agentPreset.copy': api => api.agentPresets.copy(request({ from: 'a', agentPreset: 'b' })),
  'agentPreset.openDocument': api => api.agentPresets.openDocument(request({ agentPreset: 'default' }), new AbortController().signal),
  'agentPreset.remove': api => api.agentPresets.remove(request({ agentPreset: 'default' })),
  'goal.create': (api, sessionId) => api.goals.create(request({ sessionId, objective: 'g' })),
  'goal.edit': (api, sessionId) => api.goals.edit(request({ sessionId, ref: GOAL_REF, objective: 'g' })),
  'goal.pause': (api, sessionId) => api.goals.pause(request({ sessionId, ref: GOAL_REF })),
  'goal.resume': (api, sessionId) => api.goals.resume(request({ sessionId, ref: GOAL_REF })),
  'goal.complete': (api, sessionId) => api.goals.complete(request({ sessionId, ref: GOAL_REF })),
  'goal.clear': (api, sessionId) => api.goals.clear(request({ sessionId, ref: GOAL_REF })),
  'settings.describe': api => api.settings.describe(request({})),
  'settings.openDocument': api => api.settings.openDocument(request({}), new AbortController().signal),
  'settings.update': api => api.settings.update(request({ ns: 'general', patch: {} })),
  'settings.replace': api => api.settings.replace(request({ ns: 'general', section: {} })),
  'settings.mutate': api => api.settings.mutate(request({ ns: 'general', ops: [] })),
  'credentials.describe': api => api.credentials.describe(request({ refs: [] })),
  'credentials.set': api => api.credentials.set(request({ ref: 'env:DSH_RO_SPEC_VAR', value: 'v' })),
  'credentials.unset': api => api.credentials.unset(request({ ref: 'env:DSH_RO_SPEC_VAR' })),
  'llm.providers': api => api.llm.providers(request({})),
  'llm.models': api => api.llm.models(request({})),
  'llm.discoverModels': api => api.llm.discoverModels(request({ settingsNs: 'ns', provider: 'p' }), new AbortController().signal),
}

/** Outcome of one guarded call: either the narrow response or an impl throw. */
type Outcome =
  | { kind: 'response'; code: string | undefined }
  | { kind: 'threw' }

async function outcome(promise: Promise<RpcResponse<unknown>>): Promise<Outcome> {
  try {
    const response = await promise
    return { kind: 'response', code: response.result.ok ? undefined : response.result.error.code }
  } catch {
    // An implementation crash (missing optional service) also proves the call
    // got past the guard; the read rows below pin exact codes separately.
    return { kind: 'threw' }
  }
}

/** Compose the minimal context plus the stub services the browse-safe rows read. */
async function readOnlyHarness(): Promise<{ api: ApiProxy; sessionId: SessionId }> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  const session = ctx.sessions.create()
  ctx.agents.register({ id: session.id, session, status: 'idle', ctx } as Agent)
  ctx.provide('subagents', { listChildren: () => Promise.resolve([]) })
  ctx.provide('workspaceRegistry', { list: () => [], archivedSessionIds: [] })
  ctx.provide('llm', {
    listProviders: () => [],
    listConfigurableProviders: () => [],
    listModels: () => Promise.resolve([]),
    resolveModelInfo: () => Promise.reject(new Error('unused')),
  })
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
    cwd: '/tmp',
    readOnly: true,
  })
  return { api, sessionId: session.id }
}

describe('read-only gateway enforcement', () => {
  it('refuses every mutation-class method with the fixed read-only-mode code', async () => {
    const { api, sessionId } = await readOnlyHarness()
    for (const method of MUTATION_METHODS) {
      const result = await outcome(CALLS[method](api, sessionId))
      expect(result, method).toEqual({ kind: 'response', code: 'read-only-mode' })
    }
  })

  it('lets every browse-safe method reach its implementation', async () => {
    const { api, sessionId } = await readOnlyHarness()
    for (const method of BROWSE_SAFE) {
      const result = await outcome(CALLS[method](api, sessionId))
      expect(result.kind === 'response' && result.code === 'read-only-mode', method).toBe(false)
    }
  })

  it('serves the browsing reads for real: list, history, models, catalogs', async () => {
    const { api, sessionId } = await readOnlyHarness()
    const list = await api.sessions.list(request({}))
    expect(list.result.ok).toBe(true)
    const history = await api.sessions.history(request({ sessionId }))
    expect(history.result.ok).toBe(true)
    const models = await api.sessions.models(request({ sessionId }))
    expect(models.result.ok).toBe(true)
    const providers = await api.llm.providers(request({}))
    expect(providers.result.ok).toBe(true)
    const workspaces = await api.workspace.list(request({}))
    expect(workspaces.result.ok).toBe(true)
  })

  it('keeps the read-side channels live: respond still routes, export stays mounted', async () => {
    const { api } = await readOnlyHarness()
    const receipt = await api.respond({ type: 'client-response', rpcId: RpcId('unmatched'), result: { ok: true, value: {} } })
    expect(receipt).toEqual({ accepted: false, reason: 'not-pending' })
    expect(typeof api.downloads.sessionLog).toBe('function')
    expect(typeof api.events.mux).toBe('function')
  })

  it('leaves the unflagged proxy at the baseline: writes land, nothing answers read-only-mode', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(UserQuestionService)
    await ctx.plugin(AgentRegistry)
    const session = ctx.sessions.create()
    // The stub carries cancel() because this baseline exercises the write path.
    ctx.agents.register({ id: session.id, session, status: 'idle', ctx, cancel: () => {} } as unknown as Agent)
    const api = createApiProxy(ctx, { defaultModelSelection: () => ({ provider: 'p', model: 'm' }), cwd: '/tmp' })
    // A write row reaches its implementation (cancel answers from the live
    // agent registry) and a configuration read keeps its absent-service
    // answer — neither carries the guard's code.
    const cancelled = await api.sessions.cancel(request({ sessionId: session.id }))
    expect(JSON.stringify(cancelled.result)).not.toContain('read-only-mode')
    for (const method of ['settings.describe', 'session.prompt'] as const) {
      const result = await outcome(CALLS[method](api, session.id))
      expect(result.kind === 'response' && result.code === 'read-only-mode', method).toBe(false)
    }
  })
})
