import { consoleCompatLogger, guardFeature, probeSymbol } from '@deepseek-ai/dsh-compat'

/**
 * Compatibility guard for the S-45 settings UI slot block (ui-settings-models).
 *
 * Probes the provider-registry store surface before the zDSH slot UI registers
 * itself. The official new version moved the store into the new
 * `@deepseek-ai/dsh-client-store` package and renamed the provider vocabulary
 * (`ConfigurableProviderView → LlmConfigurableProvider`,
 * `CredentialView → CredentialInfo`, `IApiClient → ClientRemote`); the zDSH
 * fork keeps the store in `@deepseek-ai/dsh-api-remotes/client` with the old
 * names. When the official store package is present, the zDSH slot UI must be
 * disabled to avoid dual-write conflicts (COMPAT-DESIGN §4.7 + API-DELTA §7).
 * Low-conflict design: only package/symbol presence is probed, never internals.
 * Never throws — a throwing probe yields a disabled verdict.
 *
 * @module @deepseek-ai/dsh-client-ui-settings-models
 */

/**
 * Run the slot-UI compatibility guard.
 *
 * @param logger - Optional logger (see {@link import('@deepseek-ai/dsh-compat').CompatLogger});
 *   defaults to a `console`-backed logger.
 * @returns A promise resolving to `true` when the zDSH slot UI may register.
 */
export async function guardSlotUI(
  logger = consoleCompatLogger(),
): Promise<boolean> {
  const verdict = await guardFeature('dsh-slot-ui', {
    deps: [
      // The official store lives in the new dsh-client-store package with a
      // runtime defineStore export; zDSH has no such package (module-not-found).
      // Official store present → disable zDSH slots to avoid dual-write.
      {
        name: 'store:official-vs-zdsh',
        run: async () => {
          const official = await probeSymbol('@deepseek-ai/dsh-client-store', 'defineStore')
          if (official.present) return 'official store detected: zDSH slot UI must be disabled to avoid dual-write'
          return null // no official store package → zDSH store → OK to enable
        },
      },
    ],
    logger,
  })
  return verdict.enabled
}
