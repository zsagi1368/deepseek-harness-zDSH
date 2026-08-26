/** The absolute System32 taskkill resolution guarding host teardown (#268). */

import { afterEach, describe, expect, it } from 'vitest'
import { systemTaskkillPath, systemTaskkillTree } from '../src/system-taskkill.ts'

function withEnv(name: 'SystemRoot' | 'windir', value: string | undefined, run: () => void): void {
  const previous = process.env[name]
  if (value === undefined) {
    Reflect.deleteProperty(process.env, name)
  } else {
    process.env[name] = value
  }
  try {
    run()
  } finally {
    if (previous === undefined) {
      Reflect.deleteProperty(process.env, name)
    } else {
      process.env[name] = previous
    }
  }
}

describe('systemTaskkill', () => {
  afterEach(() => {
    Reflect.deleteProperty(process.env, 'SystemRoot')
    Reflect.deleteProperty(process.env, 'windir')
  })

  it('resolves an absolute path under the configured system root', () => {
    withEnv('SystemRoot', 'D:\\WinNT', () => {
      expect(systemTaskkillPath().toLowerCase()).toBe('d:\\winnt\\system32\\taskkill.exe')
    })
  })

  it('falls back to windir, then the conventional root, keeping the result absolute', () => {
    process.env.windir = 'C:\\WINDOWS'
    expect(systemTaskkillPath().toLowerCase()).toBe('c:\\windows\\system32\\taskkill.exe')
    withEnv('windir', undefined, () => {
      // The literal last resort must still be absolute: a relative resolution
      // would reintroduce the working-directory lookup #268 closes.
      expect(systemTaskkillPath()).toContain(':')
      expect(systemTaskkillPath().toLowerCase().endsWith('\\system32\\taskkill.exe')).toBe(true)
    })
  })

  it('treats a non-positive pid as a no-op like POSIX group signalling does', () => {
    expect(() => {
      systemTaskkillTree(0, true)
    }).not.toThrow()
    expect(() => {
      systemTaskkillTree(-5, false)
    }).not.toThrow()
  })
})
