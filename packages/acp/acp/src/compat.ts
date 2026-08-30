/**
 * Compatibility guard for the ACP session resume/load feature (S-08).
 *
 * Probes the installed `@agentclientprotocol/sdk` to determine the resume
 * strategy: use the official SDK's native `AcpSession` (when the `agent`
 * symbol is present), fall back to the zDSH `AgentSideConnection`, or
 * disable the feature entirely when neither is found.  Also checks that
 * the `@deepseek-ai/dsh-user-approval` `APPROVAL_POLICIES` constant is
 * importable, so the permission overlay can be offered.
 *
 * The decision surface follows COMPAT-DESIGN SS4.4 and API-DELTA SS6:
 * the official new SDK replaces zDSH resume with its own
 * session-management layer, and only the permission-overlay option
 * is retained as a zDSH overlay.
 *
 * @module @deepseek-ai/dsh-acp
 */

import { consoleCompatLogger, guardFeature, probeSymbol } from '@deepseek-ai/dsh-compat'
import type { CompatLogger } from '@deepseek-ai/dsh-compat'

/**
 * Run the ACP compatibility guard.
 *
 * @param logger - Optional logger; defaults to a `console`-backed logger.
 * @returns A verdict with the overall enabled flag, the chosen resume
 *   strategy, and whether the permission overlay is available.
 */
export async function guardACP(
  logger: CompatLogger = consoleCompatLogger(),
): Promise<{
  enabled: boolean
  resumeStrategy: 'use-official' | 'use-zdsh' | 'disabled'
  permissionOverlay: boolean
}> {
  const officialSessionCheck = {
    name: 'acp:official-session',
    run: async () => {
      const official = await probeSymbol('@agentclientprotocol/sdk', 'agent', v => typeof v === 'function')
      if (official.present) return null // official SDK present -> use official resume
      const zdsh = await probeSymbol('@agentclientprotocol/sdk', 'AgentSideConnection')
      if (!zdsh.present) return 'neither official nor zDSH ACP SDK found'
      return null // zDSH SDK -> use zDSH resume
    },
  }
  const approvalOverlayCheck = {
    name: 'acp:approval-overlay',
    run: async () => {
      try {
        const { APPROVAL_POLICIES } = await import('@deepseek-ai/dsh-user-approval')
        return typeof APPROVAL_POLICIES === 'object' ? null : 'APPROVAL_POLICIES not an object'
      } catch {
        return 'cannot import APPROVAL_POLICIES'
      }
    },
  }

  const verdict = await guardFeature('dsh-acp', { deps: [officialSessionCheck, approvalOverlayCheck], logger })
  if (!verdict.enabled) {
    return { enabled: false, resumeStrategy: 'disabled', permissionOverlay: false }
  }

  // Re-check which SDK is present to determine the strategy.
  const official = await probeSymbol('@agentclientprotocol/sdk', 'agent', v => typeof v === 'function')
  const approvalOk = (await approvalOverlayCheck.run()) === null

  return {
    enabled: true,
    resumeStrategy: official.present ? 'use-official' : 'use-zdsh',
    permissionOverlay: approvalOk,
  }
}
