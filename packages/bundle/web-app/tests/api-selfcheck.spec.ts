/**
 * The startup /api self-check: probe classification against real local
 * servers (healthy, fence-refused, unreachable) and the boot guidance text
 * rendered from each outcome.
 */

import { createServer, type Server, type ServerResponse } from 'node:http'
import { afterAll, describe, expect, it } from 'vitest'
import type { AddressInfo } from 'node:net'
import { apiSelfCheckGuidance, API_SELF_CHECK_TIMEOUT_MS, probeApiSelfCheck } from '../src/api-selfcheck.ts'

/** Servers kept alive across the suite; every test registers its cleanup here. */
const servers: Server[] = []

afterAll(async () => {
  await Promise.all(servers.map(server => new Promise<void>((resolve, reject) => {
    server.close((error) => { if (error === undefined || error === null) resolve(); else reject(error) })
  })))
})

/** Serve one fixed response shape from a real loopback server. */
async function serve(respond: (response: ServerResponse) => void): Promise<string> {
  const server = createServer((_request, response) => {
    respond(response)
    response.end()
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
}

describe('probeApiSelfCheck', () => {
  it('reads a healthy /api surface as ok: any non-403 answer proves the fence passed', async () => {
    // The route answers the events path with 426 upgrade-required before the
    // bridge runs; the probe only needs "not a fence rejection".
    const healthy = await serve((response) => { response.writeHead(426) })
    await expect(probeApiSelfCheck(healthy)).resolves.toEqual({ kind: 'ok', status: 426 })
  })

  it('reads a fence rejection as fenced, carrying the x-dsh-api-trust reason', async () => {
    const refused = await serve((response) => {
      response.writeHead(403, { 'x-dsh-api-trust': 'untrusted-host' })
      response.write('forbidden (untrusted-host)')
    })
    await expect(probeApiSelfCheck(refused)).resolves.toEqual({ kind: 'fenced', reason: 'untrusted-host' })
  })

  it('tolerates a 403 without the reason header: the guidance still renders', async () => {
    const bare = await serve((response) => { response.writeHead(403) })
    await expect(probeApiSelfCheck(bare)).resolves.toEqual({ kind: 'fenced', reason: undefined })
  })

  it('classifies a closed port as unreachable with the connection-refused code', async () => {
    const dead = createServer()
    await new Promise<void>(resolve => dead.listen(0, '127.0.0.1', resolve))
    const port = (dead.address() as AddressInfo).port
    await new Promise<void>(resolve => dead.close(() => { resolve() }))
    const outcome = await probeApiSelfCheck(`http://127.0.0.1:${String(port)}`)
    expect(outcome.kind).toBe('unreachable')
    if (outcome.kind === 'unreachable') expect(outcome.detail).toBe('ECONNREFUSED')
  })

  it('classifies an unresponsive peer as unreachable once the abort budget expires', async () => {
    const silent = createServer() // accepts connections, never answers
    servers.push(silent)
    await new Promise<void>(resolve => silent.listen(0, '127.0.0.1', resolve))
    const address = `http://127.0.0.1:${String((silent.address() as AddressInfo).port)}`
    const outcome = await probeApiSelfCheck(address, 50)
    expect(outcome).toEqual({ kind: 'unreachable', detail: 'timed out after 50ms' })
  })

  it('refuses to follow a redirect: interference surfaces as unreachable, off-machine hops never happen', async () => {
    const redirecting = await serve((response) => {
      response.writeHead(302, { location: 'http://example.invalid/away' })
    })
    const outcome = await probeApiSelfCheck(redirecting)
    expect(outcome.kind).toBe('unreachable')
  })

  it('fails loud on a non-http base URL — a composition bug, not a probe outcome', async () => {
    await expect(probeApiSelfCheck('ftp://127.0.0.1:21')).rejects.toThrow(/needs an http\(s\) base URL/)
  })

  it('exposes its default timeout as a module constant', () => {
    expect(API_SELF_CHECK_TIMEOUT_MS).toBeGreaterThan(0)
  })
})

describe('apiSelfCheckGuidance', () => {
  it('stays quiet when the check passed — a healthy boot prints only its usual lines', () => {
    expect(apiSelfCheckGuidance({ kind: 'ok', status: 426 }, 'http://127.0.0.1:3080')).toEqual([])
  })

  it('names the rejected format, both remedies, and where the reason is readable when fenced', () => {
    const lines = apiSelfCheckGuidance({ kind: 'fenced', reason: 'untrusted-host' }, 'http://127.0.0.1:3080')
    expect(lines).toHaveLength(3)
    expect(lines[0]).toContain('forbidden (untrusted-host)')
    expect(lines[0]).toContain('http://127.0.0.1:3080')
    expect(lines[1]).toContain('Host it does not recognize')
    expect(lines[2]).toContain('--trusted-host <host[:port]>')
    expect(lines[2]).toContain('x-dsh-api-trust')
  })

  it('renders a headerless 403 without inventing a reason token', () => {
    const [first] = apiSelfCheckGuidance({ kind: 'fenced', reason: undefined }, 'http://127.0.0.1:3080')
    expect(first).toContain('rejected with forbidden ')
    expect(first).not.toContain('forbidden ()')
  })

  it('points at the machine when the probe could not connect at all', () => {
    const lines = apiSelfCheckGuidance(
      { kind: 'unreachable', detail: 'ECONNREFUSED' },
      'http://127.0.0.1:3080',
    )
    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain('http://127.0.0.1:3080/api/events.mux')
    expect(lines[0]).toContain('ECONNREFUSED')
    expect(lines[1]).toContain('loopback')
  })
})
