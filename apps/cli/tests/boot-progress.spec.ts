/**
 * #176 pin: boot-chain phase progress. Each phase announces itself and prints
 * one completion line with a caller-provided detail and an injected-clock
 * duration; the gate follows the sink's TTY bit (or an explicit override), a
 * disabled reporter writes nothing, and a rejected phase propagates after only
 * the start line so the boot's own failure diagnostics stay authoritative.
 */

import { describe, expect, it } from 'vitest'
import { createBootProgress, formatDuration } from '../src/boot-progress.ts'
import type { ProgressStream } from '../src/boot-progress.ts'

/** A capturing sink plus the lines it collected, with an optional TTY bit. */
function fakeStream(isTTY?: boolean): { lines: string[]; stream: ProgressStream } {
  const lines: string[] = []
  const stream: ProgressStream = {
    write: chunk => void lines.push(chunk),
    ...(isTTY === undefined ? {} : { isTTY }),
  }
  return { lines, stream }
}

describe('formatDuration', () => {
  it('renders sub-second, fractional, and long durations in one style', () => {
    expect(formatDuration(40)).toBe('0.0s')
    expect(formatDuration(400)).toBe('0.4s')
    expect(formatDuration(1500)).toBe('1.5s')
    expect(formatDuration(61_500)).toBe('61.5s')
  })
})

describe('createBootProgress', () => {
  it('stays silent on a non-TTY sink while the work still runs', async () => {
    const { lines, stream } = fakeStream(false)
    const progress = createBootProgress({ prefix: 'dsh web', out: stream })
    const result = await progress.phase('resolving configuration', () => 42)
    expect(result).toBe(42)
    expect(lines).toEqual([])
  })

  it('defaults its gate to the sink TTY bit and honors the explicit override', async () => {
    const tty = fakeStream(true)
    await createBootProgress({ prefix: 'dsh web', out: tty.stream }).phase('loading plugins', () => undefined)
    expect(tty.lines).toHaveLength(2)

    const forcedOff = fakeStream(true)
    await createBootProgress({ prefix: 'dsh web', out: forcedOff.stream, enabled: false })
      .phase('loading plugins', () => undefined)
    expect(forcedOff.lines).toEqual([])
  })

  it('announces the phase and summarizes it with the injected clock duration', async () => {
    const { lines, stream } = fakeStream(true)
    let nowMs = 100
    const progress = createBootProgress({ prefix: 'dsh web', out: stream, now: () => nowMs })
    const promise = progress.phase('loading plugins', async () => {
      nowMs += 1700
      return ['base', 'web-app'] as string[]
    }, mounted => `${mounted.length} plugin entries mounted (${mounted.join(', ')})`)

    // The start line exists before the work settles — that is the point.
    expect(lines).toEqual(['dsh web: loading plugins…\n'])
    await promise
    expect(lines).toEqual([
      'dsh web: loading plugins…\n',
      'dsh web: 2 plugin entries mounted (base, web-app) (1.7s)\n',
    ])
  })

  it('falls back to a default summary detail when none is provided', async () => {
    const { lines, stream } = fakeStream(true)
    const progress = createBootProgress({ prefix: 'dsh headless', out: stream, now: () => 5 })
    await progress.phase('resolving configuration', () => 'profile')
    expect(lines[1]).toBe('dsh headless: resolving configuration done (0.0s)\n')
  })

  it('propagates a phase failure without printing a completion line', async () => {
    const { lines, stream } = fakeStream(true)
    const progress = createBootProgress({ prefix: 'dsh web', out: stream, now: () => 0 })
    await expect(progress.phase('loading plugins', () => Promise.reject(new Error('plugin tree failed to load'))))
      .rejects.toThrow('plugin tree failed to load')
    expect(lines).toEqual(['dsh web: loading plugins…\n'])
  })
})
