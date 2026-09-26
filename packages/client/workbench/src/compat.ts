/**
 * Compatibility guard for the workbench dock (T4 bare-process settle).
 *
 * Probes the core dependency symbols before the workbench registers itself,
 * so a partially-loaded or upstream-drifted host degrades gracefully instead
 * of throwing during registration. Low-conflict design per COMPAT-DESIGN
 * §4.3: only the presence of core symbols is checked, never their internals.
 *
 * @module @deepseek-ai/dsh-client-workbench
 */

import { consoleCompatLogger, guardFeature } from '@deepseek-ai/dsh-compat'

/**
 * Run the workbench compatibility guard.
 *
 * Verifies that the workbench's peer symbols are importable and callable;
 * when any probe fails the verdict is `false` and the workbench must skip
 * registration. Never throws — every probe failure (including a throwing
 * import) is turned into a disabled verdict by the underlying guard.
 *
 * @param logger - Optional logger (see {@link import('@deepseek-ai/dsh-compat').CompatLogger});
 *   defaults to a `console`-backed logger.
 * @returns A promise resolving to `true` when the feature may register.
 */
export async function guardWorkbench(
  logger = consoleCompatLogger(),
): Promise<boolean> {
  const verdict = await guardFeature('dsh-workbench', {
    deps: [
      {
        name: 'cordis:Service',
        run: async () => {
          try {
            const { Service } = await import('@deepseek-ai/cordis')
            return typeof Service === 'function' ? null : 'Service not a function'
          } catch {
            return 'cannot import cordis Service'
          }
        },
      },
    ],
    logger,
  })
  return verdict.enabled
}
