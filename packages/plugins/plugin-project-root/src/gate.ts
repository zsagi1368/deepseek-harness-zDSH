/**
 * Gate pipeline for project plugin candidates: clamp + LoadGuard.preLoad +
 * capability rejections (llm-adapter).
 *
 * Every candidate enters the gate; the output is `{ accepted, report }` where
 * `accepted` are candidates that passed all checks and `report` is a complete
 * audit trail of every verdict (rejected, warned, or accepted).
 * @module @deepseek-ai/dsh-plugin-project-root
 */

import { LoadGuard, type Plugin } from '@deepseek-ai/dsh-plugin-governance'
import { clampProjectPluginSandbox } from './clamp.ts'
import type { DiscoveredProjectPlugin, ProjectPluginCandidate, GateReportEntry } from './types.ts'

/**
 * Kernel version handed to LoadGuard.preLoad, mirroring the running branch
 * version. Keep in sync with the branch release (0.1.1-rc.2 family); project
 * manifests declaring `dsh.compatible` windows are judged against it.
 */
export const PROJECT_PLUGIN_KERNEL_VERSION = '0.1.1-rc.2'

/** Options for {@link gate}. */
export interface GateOptions {
  /** Kernel version for LoadGuard.preLoad (defaults to the branch version). */
  kernelVersion?: string
}

/**
 * Gate one set of discovered candidates through the host clamp and
 * LoadGuard.preLoad, rejecting those that fail.
 *
 * @param candidates - the raw discovered candidates.
 * @param options - optional overrides (kernel version for the load guard).
 * @returns the accepted (clamped + guard-allowed) list and the full gate report.
 */
export async function gate(
  candidates: DiscoveredProjectPlugin[],
  options: GateOptions = {},
): Promise<{
  accepted: ProjectPluginCandidate[]
  report: GateReportEntry[]
}> {
  const accepted: ProjectPluginCandidate[] = []
  const report: GateReportEntry[] = []
  const loadGuard = new LoadGuard()
  const kernelVersion = options.kernelVersion ?? PROJECT_PLUGIN_KERNEL_VERSION
  const seenIds = new Set<string>()

  for (const candidate of candidates) {
    const { id, version, projectRoot, pluginDir, manifest } = candidate

    // --- Duplicate id check ---
    if (seenIds.has(id)) {
      report.push({
        root: projectRoot,
        id,
        version,
        verdict: 'rejected',
        check: 'duplicate-id',
        message: `duplicate plugin id ${JSON.stringify(id)} in project root ${projectRoot}; second occurrence rejected`,
      })
      continue
    }
    seenIds.add(id)

    // --- Clamp ---
    const clampResult = clampProjectPluginSandbox(
      manifest.sandbox,
      pluginDir,
    )
    for (const rejection of clampResult.rejections) {
      report.push({
        root: projectRoot,
        id,
        version,
        verdict: 'rejected',
        check: rejection.check,
        message: rejection.message,
      })
    }
    if (clampResult.rejections.length > 0) continue

    // --- llm-adapter capability rejection (B-03) ---
    const hasLlmAdapter = manifest.capabilities.some(
      cap => cap.type === 'llm-adapter',
    )
    if (hasLlmAdapter) {
      report.push({
        root: projectRoot,
        id,
        version,
        verdict: 'rejected',
        check: 'capability-llm-adapter',
        message: `llm-adapter capability is not allowed for project plugins (B-03) at ${projectRoot}`,
      })
      continue
    }

    // --- LoadGuard.preLoad ---
    const plugin: Plugin = {
      manifest: {
        ...manifest,
        sandbox: clampResult.effective,
      },
      install: () => {},
      uninstall: () => {},
    }
    const loadResult = await loadGuard.preLoad(plugin, kernelVersion)
    if (!loadResult.allowed) {
      for (const failure of loadResult.failures) {
        report.push({
          root: projectRoot,
          id,
          version,
          verdict: 'rejected',
          check: failure.check,
          message: failure.message,
        })
      }
      continue
    }

    // --- Warnings from clamp ---
    for (const warning of clampResult.warnings) {
      report.push({
        root: projectRoot,
        id,
        version,
        verdict: 'warned',
        check: warning.check,
        message: warning.message,
      })
    }

    // --- Accepted ---
    accepted.push({
      ...candidate,
      clampedSandbox: clampResult.effective,
    })
    report.push({
      root: projectRoot,
      id,
      version,
      verdict: 'mounted',
      check: 'gate-passed',
      message: `plugin ${JSON.stringify(id)} v${version} accepted at ${projectRoot}`,
    })
  }

  return { accepted, report }
}
