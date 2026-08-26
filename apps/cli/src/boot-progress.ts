/**
 * Lightweight, TTY-gated phase progress for the launcher's boot chain.
 *
 * A first `npx` run can spend minutes before any launcher statement executes;
 * what the launcher owns is visibility once its own code is running. Each
 * sizeable boot phase (configuration resolution, plugin loading) reports one
 * start line and one single-line completion summary on stderr — interactive
 * terminals only, so piped, captured, and machine-consumed output stays exactly
 * as quiet as before, and the two added `write` calls per phase never slow the
 * boot itself.
 * @module @deepseek-ai/dsh/boot-progress
 */

/** The stream slice progress lines are written to (`process.stderr` in production). */
export interface ProgressStream {
  /** True only when the stream renders on an interactive terminal. */
  isTTY?: boolean
  /** Accepts one complete progress line (terminating newline included). */
  write(chunk: string): unknown
}

/** Construction options for {@link createBootProgress}. */
export interface BootProgressOptions {
  /** Line prefix naming the launcher and booted profile, e.g. `dsh web`. */
  prefix: string
  /** Output sink; defaults to `process.stderr`. */
  out?: ProgressStream
  /**
   * Hard enable/disable override for the reporting gate. When omitted,
   * reporting is enabled exactly when the sink's {@link ProgressStream.isTTY}
   * is true; a test or embedded host passes true/false to force either side.
   */
  enabled?: boolean
  /** Millisecond clock; defaults to `Date.now`, injectable for deterministic tests. */
  now?: () => number
}

/** Per-phase reporter shared by one profile boot. */
export interface BootProgress {
  /**
   * Run one labelled boot phase: announce it, time it, then print its
   * single-line summary. When reporting is disabled the work runs unchanged
   * with nothing written. A rejected phase propagates its error after only the
   * start line — the boot's own fail-loud path owns failure diagnostics.
   * @param label - the phase name, printed as `<prefix>: <label>…` before the work starts.
   * @param run - the phase work; sync or async.
   * @param completion - maps the settled result onto the summary's detail text;
   *   defaults to `<label> done`. The duration in seconds is appended by this method.
   * @returns the phase result, verbatim from {@link run}.
   */
  phase<T>(label: string, run: () => Promise<T> | T, completion?: (result: T) => string): Promise<T>
}

/**
 * Render a duration for a progress summary: seconds with one decimal, so both
 * a fast local start (`0.3s`) and a slow cold one (`61.5s`) read at a glance.
 * @param elapsedMs - the measured wall-clock duration in milliseconds.
 * @returns the duration formatted as `<seconds>s`.
 */
export function formatDuration(elapsedMs: number): string {
  return `${(elapsedMs / 1000).toFixed(1)}s`
}

/**
 * Create the phase reporter for one profile boot.
 * @param options - prefix, sink, gate override, and clock; see {@link BootProgressOptions}.
 * @returns the reporter whose {@link BootProgress.phase} wraps each timed stage.
 */
export function createBootProgress(options: BootProgressOptions): BootProgress {
  const out = options.out ?? process.stderr
  // The gate is decided once: stderr cannot turn into a terminal mid-boot, and
  // a stable decision keeps the line count of one boot deterministic.
  const enabled = options.enabled ?? out.isTTY === true
  const now = options.now ?? Date.now
  return {
    async phase(label, run, completion) {
      if (!enabled) return await run()
      out.write(`${options.prefix}: ${label}…\n`)
      const startedAt = now()
      // No try/catch on purpose: a rejection must skip the summary line — the
      // failing phase reports through the boot's labelled failure instead.
      const result = await run()
      const detail = completion === undefined ? `${label} done` : completion(result)
      out.write(`${options.prefix}: ${detail} (${formatDuration(now() - startedAt)})\n`)
      return result
    },
  }
}
