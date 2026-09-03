/**
 * Copy plumbing for the self-mounting workbench shell. The plugin body binds
 * the shared `LocaleRuntime` (`ctx.locale.bind(WORKBENCH_NS)`) and feeds the
 * bound translator down through this context, so every component reads the
 * active locale at render time without owning a Cordis dependency. Components
 * outside React (panel descriptor titles, command palette titles) receive the
 * same `t` through registration closures in `index.ts`.
 */
import { createContext, useContext } from 'react'
import { zh, type WorkbenchKey } from '../locales.ts'

/**
 * The workbench translate seat: a dictionary key to localized copy. Bound to
 * the shared `LocaleRuntime` by the plugin body; components must not assume a
 * specific language.
 */
export type WorkbenchTranslate = (key: WorkbenchKey) => string

/**
 * Fail-closed default: the package's own `zh` dictionary. The workbench
 * started as a self-contained Chinese-first dock, and the shell-mount client
 * tests assert against that copy; the provider installed by the plugin body
 * always overrides this with the active-locale translator.
 * @param key - the dictionary key to render.
 * @returns the Chinese copy for `key`.
 */
export const fallbackTranslate: WorkbenchTranslate = key => zh[key]

/** React context carrying the active-locale translator; default is {@link fallbackTranslate}. */
export const WorkbenchLocaleContext = createContext<WorkbenchTranslate>(fallbackTranslate)

/**
 * Read the workbench translate seat.
 * @returns the translator supplied by the plugin body, or the fail-closed zh default.
 */
export function useWorkbenchT(): WorkbenchTranslate {
  return useContext(WorkbenchLocaleContext)
}
