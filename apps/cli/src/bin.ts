#!/usr/bin/env node
/**
 * dsh — command-line entry. Dynamic imports per mode keep unrelated modes out
 * of each dispatch path; the adapter prints and exits for
 * `--help`/`--version`/a parse error, so only a valid mode reaches the switch.
 * @module @deepseek-ai/dsh/bin
 */

/* v8 ignore file -- built-bin acceptance exercises this self-executing dispatch. */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { parseDshArgs } from './args.ts'
import { describeRuntimeSupport } from './runtime-guard.ts'
import { printStartupBanner } from './startup-banner.ts'

// Runtime guard — the launcher's first statement. It probes for a capability
// (`AbortSignal.timeout`, Node >= 17.3, also absent from some embedded
// runtimes) whose lack otherwise explodes as an opaque TypeError from deep
// inside a boot. Only light launcher code (node builtins, the arg parser, this
// probe) has loaded by now: every mode tree below is a dynamic import reached
// only after this check passes.
const runtimeSupport = describeRuntimeSupport()
if (!runtimeSupport.ok) {
  process.stderr.write(`${runtimeSupport.detail}\n`)
  process.exit(1)
}

// Both the source tree (apps/cli/src) and the bundled bin (apps/cli/lib) sit
// one directory under apps/cli, so the checked-in manifest resolves with the
// same relative hop from either artifact.
/** This app's version, read from its checked-in package.json. */
function readVersion(): string {
  const manifest = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  ) as { version?: unknown }
  return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
}

const version = readVersion()
const invocation = parseDshArgs(process.argv.slice(2), version)

// First-impression banner (#176): the earliest honest signal that this process
// is alive and what it is about to boot, with a first-start expectation hint —
// npx's own download window before this line is outside our control. Profile
// boots only: a config dump's machine-read text and `plugin`'s pnpm forwarding
// stay silent even on a terminal, and the banner itself prints on interactive
// terminals only. `acp` stays silent unconditionally: stdout carries its
// JSON-RPC protocol frames.
if (invocation.mode === 'profile') printStartupBanner(version, invocation.profile)

switch (invocation.mode) {
  case 'profile': {
    // Loaded with the mode tree, after the runtime guard: no heavy dependency
    // may evaluate before the launcher has proven the host can run at all.
    const { loadLayeredEnv } = await import('@deepseek-ai/dsh-app-boot')
    const { runProfile } = await import('./profile-boot.ts')
    await runProfile({
      environment: loadLayeredEnv('dsh'),
      profile: invocation.profile,
      patchFiles: invocation.patches,
      args: invocation.args,
    })
    break
  }
  case 'acp': {
    const { loadLayeredEnv } = await import('@deepseek-ai/dsh-app-boot')
    const { runAcp } = await import('./acp.ts')
    await runAcp(invocation, loadLayeredEnv('dsh'))
    break
  }
  case 'plugin': {
    const { runPlugin } = await import('./plugin.ts')
    process.exit(runPlugin(invocation.profile, invocation.args))
    break
  }
  case 'dump-config': {
    const { runDumpConfig } = await import('./dump-config.ts')
    runDumpConfig(invocation.profile, invocation.defaultOnly, invocation.patches)
    break
  }
  default:
    invocation satisfies never
    throw new Error(`dsh: unhandled invocation mode ${JSON.stringify(invocation)}`)
}
