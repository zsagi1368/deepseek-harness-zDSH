/** Detection matrix for commands terminating the harness host itself (#387). */

import { describe, expect, it } from 'vitest'
import { hostProcessChain, selfProcessNames, selfTerminationCommand } from '../src/self-kill.ts'

const SELF = 4242
const PARENT = 400
const PIDS = [SELF, PARENT]
const NAMES = ['dsh', 'dsh.js', 'node']

function probe(command: string, overrides: { dialect?: 'bash' | 'pwsh'; pids?: number[]; names?: string[] } = {}) {
  const base: { dialect: 'bash' | 'pwsh'; command: string; protectedPids: number[]; selfNames: string[] } = {
    dialect: overrides.dialect ?? 'bash',
    command,
    protectedPids: overrides.pids ?? PIDS,
    selfNames: overrides.names ?? NAMES,
  }
  return base
}

/** Every listed command must be refused, carrying the guidance in the reason. */
function expectHits(commands: string[], overrides: { dialect?: 'bash' | 'pwsh'; pids?: number[]; names?: string[] } = {}): void {
  for (const command of commands) {
    const reason = selfTerminationCommand(probe(command, overrides))
    expect(reason, command).toContain('harness host process')
    expect(reason, command).toContain('external terminal')
    expect(reason, command).toContain('persisted and recoverable')
  }
}

/** Every listed command must stay allowed. */
function expectPasses(commands: string[], overrides: { dialect?: 'bash' | 'pwsh'; pids?: number[]; names?: string[] } = {}): void {
  for (const command of commands) {
    expect(selfTerminationCommand(probe(command, overrides)), command).toBeUndefined()
  }
}

describe('hostProcessChain', () => {
  it('starts at this process and reaches its parent through process.ppid', () => {
    const chain = hostProcessChain()
    expect(chain[0]).toBe(process.pid)
    expect(chain).toContain(process.ppid)
  })

  it('honors the depth cap and never loops on a cyclic chain', () => {
    expect(hostProcessChain(1)).toEqual([process.pid])
    expect(hostProcessChain(0)).toEqual([])
    // An injected cyclic resolver pins the visited-set guard; the cap alone
    // would also stop, but the walk must terminate either way.
    const cyclic = (pid: number): number | undefined => (pid === 1 ? 2 : 1)
    expect(hostProcessChain(8, cyclic)[0]).toBe(process.pid)
  })

  it('stops at a resolver-reported unknown parent and keeps degenerate pids out of the way', () => {
    expect(hostProcessChain(8, () => undefined)).toEqual([process.pid])
  })
})

describe('selfProcessNames', () => {
  it('includes the interpreter binary name and the entry-script stem', () => {
    const names = selfProcessNames()
    expect(names).toContain('node')
    // The entry script under vitest is a .js/.mjs file; its stem answers to name-based killers.
    const entry = (process.argv[1] ?? '').split(/[\\/]/).pop() ?? ''
    if (/\.(mjs|cjs|js|mts|cts|ts)$/.test(entry)) {
      expect(names).toContain(entry.toLowerCase().replace(/\.(mjs|cjs|js|mts|cts|ts)$/, ''))
    }
  })

  it('returns clean sorted unique lowercase names without path or whitespace decoration', () => {
    const names = selfProcessNames()
    expect(names).toEqual([...new Set(names)].sort())
    for (const name of names) {
      // Dots stay only where they are the script's own extension (`dsh.js`);
      // path separators and whitespace never survive.
      expect(name).not.toMatch(/[\\ /]/)
      expect(name.length).toBeGreaterThan(0)
      expect(name).toBe(name.toLowerCase())
    }
  })
})

describe('bash terminations aimed at the host are detected', () => {
  it('refuses every shape with the restart guidance', () => {
    expectHits([
      // Direct pid targets, every signal spelling.
      'kill 4242',
      'kill -9 4242',
      'kill -TERM 4242',
      'kill -s KILL 4242',
      'kill --signal=KILL 4242',
      'kill -- 4242',
      'kill 111 4242 333',
      '/bin/kill -9 4242',
      'kill -9 400',
      // The group-wide spellings that necessarily include the host.
      'kill 0',
      'kill -- -1',
      'kill -9 -- -1',
      // Name-based killers matching the host's own names exactly.
      'pkill dsh',
      'pkill -9 dsh',
      'pkill -f dsh',
      'pkill node',
      'killall dsh',
      'killall -9 dsh',
      'killall dsh.js',
      '/usr/bin/pkill dsh',
      // Windows tool reachable from bash too (MSYS doubles the slash).
      'taskkill /PID 4242',
      'taskkill /F /PID 4242',
      'taskkill /PID 111,4242',
      'taskkill /IM node.exe',
      'taskkill /IM DSH',
      'taskkill //PID 4242 /T',
      'taskkill /FI "IMAGENAME eq node.exe"',
      'taskkill /FI "PID eq 4242"',
      // Hidden behind an earlier harmless segment or word.
      'echo hi; kill 4242',
      'cd /tmp && kill -9 4242',
      'rm -rf build | tee log; taskkill /IM dsh.exe',
      'xargs kill 4242',
      'sudo pkill dsh',
      // Degenerate operator placement still parses into segments.
      '; kill 4242 ;',
    ])
  })
})

describe('bash terminations of unrelated targets stay ungated', () => {
  it('leaves every unrelated shape alone', () => {
    expectPasses([
      'kill 9999',
      'kill -9 9999',
      'kill abc',
      'kill %1',
      'kill -l',
      'kill',
      'kill -1',
      'kill -s 9 9999',
      'kill -- -500',
      'kill $PID',
      // Beyond Number.MAX_SAFE_INTEGER the operand is no resolvable pid.
      'kill 99999999999999999999',
      'pkill chrome',
      'pkill ds',
      "pkill '^dsh$'",
      'pkill DSH',
      'pkill',
      'killall Finder',
      'killall -e nodejs',
      'killall NODE',
      'taskkill /PID 7777',
      'taskkill /IM chrome.exe',
      'taskkill /FI "IMAGENAME ne node.exe"',
      'taskkill /FI "WINDOWTITLE eq dsh"',
      'rm -rf .',
      'npm run restart',
    ])
  })
})

it('prefers a false positive over a dead host when a protected pid rides along any word', () => {
  // `echo kill <own-pid>` merely prints text, but the conservative bar holds:
  // one wasted retry beats one dead session.
  expect(selfTerminationCommand(probe('echo kill 4242'))).toContain('pid 4242')
})

describe('pid parsing boundaries (#387 test matrix)', () => {
  it('carries the matched pid in the reason for self and parent hits', () => {
    expect(selfTerminationCommand(probe('kill -9 4242'))).toContain('pid 4242')
    expect(selfTerminationCommand(probe('kill 400'))).toContain('pid 400')
  })

  it('names the special group-wide spellings explicitly', () => {
    expect(selfTerminationCommand(probe('kill 0'))).toContain('whole process group')
    expect(selfTerminationCommand(probe('kill -- -1'))).toContain('every process accessible to this user')
  })

  it('treats non-numeric and unresolvable operands as pass-through', () => {
    expectPasses(['kill abc', 'kill %1', 'kill $PID', 'kill -- -500'])
  })

  it('ignores unknown pid sets entirely', () => {
    expect(selfTerminationCommand(probe('kill 4242', { pids: [12345] }))).toBeUndefined()
  })
})

describe('speaks PowerShell: Stop-Process, aliases, pipelines, and taskkill', () => {
  const pwsh = { dialect: 'pwsh' as const }

  it('refuses every pwsh shape with the restart guidance', () => {
    expectHits([
      'Stop-Process -Id 4242',
      'stop-process -id 400 -Force',
      'STOP-PROCESS -ID 4242',
      'Stop-Process 4242',
      'Stop-Process dsh',
      'Stop-Process -Id 999,4242',
      'Stop-Process -Name dsh',
      'stop-process -name NODE',
      'Stop-Process -Name dsh,dns',
      'spps -Id 4242',
      'kill 4242',
      // Pipelines feeding a terminator from an enumeration.
      'Get-Process dsh | Stop-Process',
      'Get-Process -Name dsh | Stop-Process',
      'Get-Process -IncludeUserName dsh | Stop-Process',
      'ps | kill',
      'Get-Process | Stop-Process -Force',
      'gps DSH | spps',
      'gps chrome | ps | Stop-Process',
      'ps dsh | kill',
      'echo x | ps | kill',
      'Start-Sleep 1; Stop-Process -Id 4242',
      'taskkill /PID 4242 /F',
    ], pwsh)
  })

  it('leaves unrelated pwsh shapes alone', () => {
    expectPasses([
      'Stop-Process -Id 9999',
      'Stop-Process -Name chrome',
      'Stop-Process chrome',
      'Stop-Process -Id',
      'Stop-Process -Name ""',
      'Stop-Process -Id $p',
      'Get-Process chrome | Stop-Process',
      'gps dshx | spps',
      // A non-enumeration feeder breaks the pipeline chain.
      'echo x | Stop-Process',
      '| ps chrome | Stop-Process',
      'Get-Process dsh | Select-Object -First 1',
      'Write-Output hi',
      'Write-Output \'Stop-Process -Id 4242\'',
      // Torn or unterminated /FI values cannot single the host out.
      'taskkill /FI',
      'taskkill /FI "IMAGENAME eq node.exe',
      'taskkill /FI "PID eq x"',
    ], pwsh)
  })

  it('reports which name matched and flags unfiltered enumerations', () => {
    expect(selfTerminationCommand(probe('Stop-Process -Name dsh', pwsh))).toContain("process name 'dsh'")
    expect(selfTerminationCommand(probe('Get-Process | Stop-Process', pwsh))).toContain('unfiltered process enumeration')
    expect(selfTerminationCommand(probe('ps | kill', pwsh))).toContain('unfiltered process enumeration')
  })

  it('matches pwsh verbs case-insensitively but keeps bash verbs case-sensitive', () => {
    expect(selfTerminationCommand(probe('STOP-PROCESS -ID 4242', pwsh))).toContain('pid 4242')
    expect(selfTerminationCommand(probe('KILL 4242'))).toBeUndefined()
  })

  it('red-team: glued operators can no longer hide the kill (R-S43 family, PASS-WITH-NOTES P1-1)', () => {
    expectHits([
      'kill 4242&&echo x',
      'kill 4242 & echo x',
      'kill 4242;echo done',
      'kill -9 4242||true',
    ])
    expectHits(['Stop-Process -Id 4242;Write-Output done', 'Stop-Process -Id 4242&&echo hi'], { dialect: 'pwsh' })
    // The pid must still be a clean number once operators split off.
    expectPasses(['kill 42429 && echo x'], {})
  })
})
