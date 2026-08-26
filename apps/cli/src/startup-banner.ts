/**
 * First-impression banner for the `dsh` launcher.
 *
 * `npx @deepseek-ai/dsh <mode>` spends its first minutes inside npm —
 * downloading and extracting the full dependency tree before any launcher
 * statement runs, with npm's own deprecation warnings as the only output. That
 * window is invisible to this package; what the launcher owns is the moment it
 * starts: one concise stderr line naming the product, version, and booted
 * profile, and stating up front that a first start may take several minutes.
 *
 * The line is written to stderr and only on an interactive terminal, so
 * machine-consumed surfaces keep their contracts: a config dump's stdout stays
 * pure text, and callers simply do not print the banner for non-boot modes at
 * all (see `bin`, which prints it for profile boots only).
 * @module @deepseek-ai/dsh/startup-banner
 */

/** The stream slice the banner is written to (`process.stderr` in production). */
export interface BannerStream {
  /** True only when the stream renders on an interactive terminal. */
  isTTY?: boolean
  /** Accepts one complete banner line (terminating newline included). */
  write(chunk: string): unknown
}

/**
 * Build the banner line: product name and version, the booted profile, and a
 * bilingual first-start expectation hint. Bilingual because slow first-run
 * networks are common exactly where the Chinese hint reads fastest (#176).
 * @param version - the running launcher's version string.
 * @param profile - the profile name being booted.
 * @returns the complete banner line, without a terminating newline.
 */
export function startupBannerLine(version: string, profile: string): string {
  return `dsh ${version} · booting profile ${profile} `
    + '(the first start may take several minutes while dependencies download '
    + '— 首次启动需下载依赖，可能需要数分钟)'
}

/**
 * Whether the banner may print on this host: interactive terminals only.
 * A piped or captured stderr belongs to scripts and CI logs, where the extra
 * line would be noise around otherwise quiet machine-consumed output.
 * @param stream - the sink the banner would be written to.
 * @returns true when {@link startupBannerLine} should be printed to `stream`.
 */
export function shouldPrintStartupBanner(stream: BannerStream): boolean {
  return stream.isTTY === true
}

/**
 * Print the banner: one newline-terminated line on an interactive terminal,
 * nothing otherwise. Callers gate further by mode — machine modes (config
 * dumps, pnpm forwarding) never reach this even on a terminal.
 * @param version - the running launcher's version string.
 * @param profile - the profile name being booted.
 * @param stream - the sink to write to; defaults to `process.stderr`.
 * @returns nothing; the banner is fire-and-forget orientation output.
 */
export function printStartupBanner(version: string, profile: string, stream: BannerStream = process.stderr): void {
  if (!shouldPrintStartupBanner(stream)) return
  stream.write(`${startupBannerLine(version, profile)}\n`)
}
