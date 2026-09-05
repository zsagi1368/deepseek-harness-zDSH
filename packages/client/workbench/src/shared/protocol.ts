/**
 * Wire vocabulary shared by the host and client halves of the workbench.
 * Framework-free: importable from Node routes, browser code, and tests alike.
 */

/** npm package name; the cordis loader mounts rows by this name. */
export const WORKBENCH_PACKAGE_NAME = '@deepseek-ai/dsh-client-workbench'

/** Every HTTP route and WebSocket upgrade this plugin owns lives under it. */
export const WORKBENCH_ROUTE_PREFIX = '/workbench'

/**
 * Plugin version. MUST equal the package.json "version"; the manifest
 * client spec guards that two-way sync.
 */
export const WORKBENCH_VERSION = '0.1.2-rc.1'

/** Answer shape of GET/POST `/workbench/api/ping` — the liveness probe used by mount e2e. */
export interface PingResult {
  ok: true
  plugin: typeof WORKBENCH_PACKAGE_NAME
  version: string
}

/**
 * Build the liveness-probe answer.
 * @returns the ping result with ok, plugin, and version fields.
 */
export function pingResult(): PingResult {
  return { ok: true, plugin: WORKBENCH_PACKAGE_NAME, version: WORKBENCH_VERSION }
}
