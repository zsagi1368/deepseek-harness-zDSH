import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const packageRoot = resolve(import.meta.dirname, '..')
const repositoryRoot = resolve(packageRoot, '..', '..', '..')
const healthRecipeScript = join(repositoryRoot, 'scripts', 'run-healthy-spec.mjs')
const bundlePath = join(packageRoot, 'lib/client.js')
const require = createRequire(import.meta.url)
const licenseNames = [
  'LICENSE',
  'cmaps/LICENSE',
  'standard_fonts/LICENSE_FOXIT',
  'standard_fonts/LICENSE_LIBERATION',
  'wasm/LICENSE_JBIG2',
  'wasm/LICENSE_OPENJPEG',
  'wasm/LICENSE_PDFJS_JBIG2',
  'wasm/LICENSE_PDFJS_OPENJPEG',
  'wasm/LICENSE_PDFJS_QCMS',
  'wasm/LICENSE_QCMS',
] as const

function run(command: string, args: string[], cwd: string, timeout: number): string {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout })
  expect(result.error).toBeUndefined()
  expect(result.signal, result.stderr).toBeNull()
  expect(result.status, result.stderr).toBe(0)
  return result.stdout
}

interface DetectedPnpm {
  kind: 'entrypoint' | 'command'
  path: string
}

interface PnpmDetectionPayload {
  ok: boolean
  pnpm?: { adopted?: { kind?: 'entrypoint' | 'command'; path?: string } | null }
  guidance?: string[]
}

/**
 * Detect the real pnpm through the repository health-recipe script
 * (`scripts/run-healthy-spec.mjs detect-pnpm --json`). That script is the
 * single source of truth for the probe order (packageManager pin
 * materialization, npm-global `node_modules/pnpm/bin/` derivation, PATH
 * pnpm), so this spec cannot drift from the recipe it is verified with.
 * Spawned as a child process (repo precedent: install-lefthook.spec.ts) to
 * keep this file free of untyped static imports.
 */
function detectPnpm(): DetectedPnpm {
  const probe = spawnSync(process.execPath, [healthRecipeScript, 'detect-pnpm', '--json'], {
    cwd: packageRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 120_000,
  })
  const payload = probe.stdout === ''
    ? undefined
    : JSON.parse(probe.stdout) as PnpmDetectionPayload
  const adopted = payload?.pnpm?.adopted ?? undefined
  if (probe.status !== 0 || payload === undefined || !payload.ok || adopted === undefined) {
    const guidance = payload?.guidance?.join(' ') ?? (probe.stderr === '' ? `exit ${String(probe.status)}` : probe.stderr)
    throw new Error(`no usable pnpm detected via ${healthRecipeScript}: ${guidance}`)
  }
  const { kind, path } = adopted
  if (kind !== 'entrypoint' && kind !== 'command') {
    throw new Error(`pnpm detection returned an unknown candidate kind: ${JSON.stringify(adopted)}`)
  }
  if (path === undefined || path === '') {
    throw new Error(`pnpm detection returned an empty path: ${JSON.stringify(adopted)}`)
  }
  return { kind, path }
}

function runPnpm(args: string[], cwd: string, timeout: number): string {
  const entrypoint = process.env.npm_execpath
  if (entrypoint !== undefined && entrypoint !== '' && /^pnpm\.[cm]?js$/iu.test(basename(entrypoint))) {
    // Launched by a real pnpm lifecycle (pnpm run/exec, CI, health recipe):
    // npm_execpath already is pnpm, keep using it without an extra probe.
    return /\.[cm]?js$/iu.test(entrypoint)
      ? run(process.execPath, [entrypoint, ...args], cwd, timeout)
      : run(entrypoint, args, cwd, timeout)
  }
  // npm_execpath is absent or points at npm-cli (bare `npx vitest`): npm's
  // `pack --json` shape differs from pnpm's (`packed.files` would be
  // undefined), so pin the packer to a detected real pnpm instead of
  // trusting the lifecycle variable.
  const pnpm = detectPnpm()
  return pnpm.kind === 'entrypoint'
    ? run(process.execPath, [pnpm.path, ...args], cwd, timeout)
    : run(pnpm.path, args, cwd, timeout)
}

describe('published PDF.js licenses', () => {
  it.skipIf(!existsSync(bundlePath))('keeps every bundled license in the packed client artifact', ({ task }) => {
    const output = mkdtempSync(join(tmpdir(), 'dsh-document-preview-pack-'))
    try {
      const packed = JSON.parse(runPnpm([
        'pack', '--json', '--pack-destination', output,
      ], packageRoot, task.timeout)) as { filename: string; files: { path: string }[] }
      expect(packed.files.map(file => file.path)).toContain('lib/client.js')
      expect(packed.files.some(file => file.path.endsWith('pdfjs-NOTICES.txt'))).toBe(false)

      const client = run('tar', ['-xOf', resolve(packageRoot, packed.filename), 'package/lib/client.js'], packageRoot, task.timeout)
      expect(client).toContain('//! Bundled PDF.js license notices')
      const pdfRoot = dirname(require.resolve('pdfjs-dist/package.json'))
      for (const name of licenseNames) {
        const source = readFileSync(join(pdfRoot, name), 'utf8').trimEnd()
        const commented = [`// ${name}`, '// ', ...source.split('\n').map(line => `// ${line}`)].join('\n')
        expect(client, `${name} must be visible in package/lib/client.js`).toContain(commented)
      }
    } finally {
      rmSync(output, { recursive: true, force: true })
    }
  })
})
