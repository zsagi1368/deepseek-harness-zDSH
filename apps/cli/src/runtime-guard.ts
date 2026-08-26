/**
 * Earliest-startup runtime capability probe for the `dsh` launcher.
 *
 * The launcher's boot trees schedule work with `AbortSignal.timeout`, an API
 * added in Node 17.3 that some embedded runtimes also omit. On such hosts the
 * absence used to surface only later as an opaque
 * `TypeError: AbortSignal.timeout is not a function` thrown from deep inside a
 * boot. `bin` calls {@link describeRuntimeSupport} before any heavy dependency
 * loads, so an unsupported host fails fast with this module's bilingual
 * explanation and a non-zero exit instead.
 * @module @deepseek-ai/dsh/runtime-guard
 */

/** The capability whose absence crashes a boot with an opaque TypeError. */
export const REQUIRED_CAPABILITY = 'AbortSignal.timeout'

/**
 * The Node release line that introduced the required capability. Embedded or
 * stripped runtimes can lack it even on newer version strings, which is why
 * the guard probes the object directly instead of parsing versions.
 */
export const CAPABILITY_SINCE_NODE = '17.3'

/**
 * The repository's supported Node range, mirrored verbatim from the root
 * package.json `engines.node` field; keep the two in sync.
 */
export const REQUIRED_NODE_ENGINES = '^22.19.0 || >=24.0.0'

/** Outcome of probing the running host for the launcher's hard requirements. */
export interface RuntimeSupport {
  /** True only when the host exposes everything the launcher needs to boot. */
  ok: boolean
  /**
   * A short confirmation note when {@link ok} is true, or the full bilingual
   * refusal message (English and Chinese, naming the missing capability, the
   * supported Node range, and the offending runtime version) ready to print
   * to stderr verbatim when it is false.
   */
  detail: string
}

/**
 * Build the bilingual refusal message printed on an unsupported host.
 * @param version - the offending runtime's `process.version` string.
 * @returns the multi-line English-and-Chinese explanation for stderr.
 */
function unsupportedDetail(version: string): string {
  return [
    `dsh: this Node runtime is missing the required capability ${REQUIRED_CAPABILITY} (available since Node ${CAPABILITY_SINCE_NODE}).`,
    `dsh：当前 Node 运行时缺少必需能力 ${REQUIRED_CAPABILITY}（自 Node ${CAPABILITY_SINCE_NODE} 起提供）。`,
    `dsh requires Node ${REQUIRED_NODE_ENGINES} (see package.json "engines"); refusing to boot rather than crash later.`,
    `dsh 要求 Node ${REQUIRED_NODE_ENGINES}（见 package.json 的 "engines" 字段）；为避免稍后在深处崩溃，这里直接拒绝启动。`,
    `Current runtime / 当前运行时: process.version=${version}. Please upgrade Node and retry. 请升级 Node 后重试。`,
  ].join('\n')
}

/**
 * Probe the running host for `AbortSignal.timeout`, the launcher's earliest
 * hard requirement, and describe the outcome for a human operator.
 *
 * The probe reads `globalThis.AbortSignal.timeout` directly instead of
 * comparing version strings: capability detection is what actually predicts
 * the crash, and embedded runtimes routinely lie about their lineage.
 * @param version - the runtime version cited in the detail text; defaults to the live `process.version`.
 * @returns `{ ok: true }` with a confirmation note exactly when
 * `globalThis.AbortSignal.timeout` is callable, otherwise `{ ok: false }` with
 * the bilingual refusal message from {@link unsupportedDetail}.
 */
export function describeRuntimeSupport(version: string = process.version): RuntimeSupport {
  const host = globalThis as { AbortSignal?: { timeout?: unknown } | undefined }
  const timeout = host.AbortSignal?.timeout
  if (typeof timeout !== 'function') {
    return { ok: false, detail: unsupportedDetail(version) }
  }
  return { ok: true, detail: `${REQUIRED_CAPABILITY} is available on ${version}; runtime guard satisfied.` }
}
