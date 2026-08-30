/**
 * Feature registration guard for the version-adaptive shim framework.
 *
 * `guardFeature` runs before a fork feature registers itself: every
 * dependency probe and conflict check must pass, otherwise the feature is
 * skipped with a warning — never throwing, never breaking the host tree.
 * The process-level audit roster records every verdict for diagnostics.
 *
 * @module @deepseek-ai/dsh-compat
 */
/**
 * Default client-side logger backed by `console`.
 * @returns A {@link CompatLogger} delegating to `console.warn`/`console.info`.
 */
export function consoleCompatLogger() {
    return {
        warn(message, ...args) {
            console.warn(message, ...args);
        },
        info(message, ...args) {
            console.info(message, ...args);
        },
    };
}
/** Process-level audit roster keyed by feature id (module-private; read via {@link getCompatRoster}). */
const compatRoster = new Map();
/**
 * Read-only snapshot of the process-level audit roster.
 * @returns A copy of the roster; mutating it does not affect future checks.
 */
export function getCompatRoster() {
    return new Map(compatRoster);
}
/**
 * Feature registration guard: call before a feature registers itself. Every
 * `deps` and `check` must pass for `enabled` to be `true`; on the first
 * failure the remaining checks are skipped (short-circuit), a warning is
 * logged, and `enabled` is `false`. Never throws; a throwing `run` counts as
 * a failure with reason `threw:<message>`. Callers must skip registration
 * when `enabled` is `false` without affecting other features.
 *
 * @param featureId - Feature identifier (e.g. 'dsh-model-slots'), also the roster key.
 * @param options - Registration options (`deps`/`check`/`logPrefix`/`logger`).
 * @returns The verdict with `enabled`/`reason`/`failures`.
 */
export async function guardFeature(featureId, options) {
    const logger = options.logger ?? consoleCompatLogger();
    const logPrefix = options.logPrefix ?? featureId;
    const failures = [];
    let reason = 'ok';
    let enabled = true;
    const runCheck = async (check) => {
        try {
            return await check.run();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return `threw:${message}`;
        }
    };
    const runPhase = async (phase) => {
        for (const check of phase ?? []) {
            const result = await runCheck(check);
            if (result !== null) {
                failures.push(check.name);
                reason = result;
                return false;
            }
        }
        return true;
    };
    if (!(await runPhase(options.deps)) || !(await runPhase(options.check))) {
        enabled = false;
    }
    compatRoster.set(featureId, { enabled, reason, checkedAt: new Date().toISOString() });
    if (!enabled) {
        try {
            logger.warn(`[compat] ${logPrefix} disabled: ${failures.join('; ')}`);
        }
        catch {
            // A throwing logger must not take the guard down.
        }
    }
    return { enabled, reason, failures };
}
//# sourceMappingURL=guard.js.map