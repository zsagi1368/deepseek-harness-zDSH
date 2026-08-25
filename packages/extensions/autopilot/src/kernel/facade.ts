/**
 * Kernel facade — THE frozen boundary between the kernel and capability
 * modules.
 *
 * Facade rule (CI-enforced): modules under src/{continue,guard,review,console}
 * may import ONLY this file's exports and their own directory. The kernel
 * never imports upward.
 */
import { AutomationCoordinator } from './coordinator.js'
import { LedgerHub, StatsCounters, createTokenSource } from './ledger.js'
import type { BackoffParams, Clock, RandomSource, StatsPersistence } from './ledger.js'
import { ProbeRegistry } from './probes.js'
import { DEFAULTS, resolveConfig } from './defaults.js'
import type { ResolvedDefaults } from './defaults.js'
import type { ModuleId } from './types.js'

/** Optional port dependencies for kernel construction. */
export interface KernelPorts {
  clock?: Clock
  rng?: RandomSource
  /** Optional synchronous snapshot persistence for stats. */
  statsPersistence?: StatsPersistence
}

/** The kernel surface capability modules are allowed to touch. */
export interface Kernel {
  readonly coordinator: AutomationCoordinator
  readonly ledger: LedgerHub
  readonly probes: ProbeRegistry
  readonly clock: Clock
  readonly rng: RandomSource
  /** Current resolved configuration (re-resolved on setConfig). */
  config(): ResolvedDefaults
  setConfig(userPatch: Record<string, unknown>): ResolvedDefaults
}

// ---------------------------------------------------------------------------
// Frozen module starter contracts (implemented by M2/M3/M4)
// ---------------------------------------------------------------------------

/** Something with an explicit dispose hook for module lifecycle control. */
export interface Disposable {
  dispose(): void
}

/** Configuration surface a continue starter receives. */
export type ContinueOptions = ResolvedDefaults['continue']
/** Configuration surface a guard starter receives. */
export type GuardOptions = ResolvedDefaults['guard']
/** Configuration surface a review starter receives. */
export type ReviewOptions = ResolvedDefaults['review']

/** Frozen continue module starter contract. */
export type ContinueModuleStarter = (kernel: Kernel, options: ContinueOptions) => Disposable
/** Frozen guard module starter contract. */
export type GuardModuleStarter = (kernel: Kernel, options: GuardOptions) => Disposable
/** Frozen review module starter contract. */
export type ReviewModuleStarter = (kernel: Kernel, options: ReviewOptions) => Disposable

/** Modules mounted by the composition root, keyed for lifecycle control. */
export interface MountedModules {
  continue?: Disposable
  guard?: Disposable
  review?: Disposable
}

/**
 * Build the kernel with its coordinator, ledger, probes, clock and config.
 * @param ports - optional injected ports (clock, rng, stats persistence).
 * @returns the assembled kernel.
 */
export function createKernel(ports: KernelPorts = {}): Kernel {
  const clock: Clock = ports.clock ?? { now: () => Date.now() }
  const rng: RandomSource = ports.rng ?? createTokenSource()

  let resolved: ResolvedDefaults = resolveConfig(DEFAULTS, {})

  const stats = new StatsCounters(clock, ports.statsPersistence?.load())
  const ledger = new LedgerHub(stats)
  const probes = new ProbeRegistry()
  const coordinator = new AutomationCoordinator()

  return {
    coordinator,
    ledger,
    probes,
    clock,
    rng,
    config: () => resolved,
    setConfig(userPatch) {
      resolved = resolveConfig(DEFAULTS, userPatch)
      return resolved
    },
  }
}

/**
 * Derive the continue backoff parameters from resolved configuration.
 * @param resolved - the resolved configuration tree.
 * @returns the backoff parameters.
 */
export function defaultBackoffParams(resolved: ResolvedDefaults): BackoffParams {
  return {
    baseMs: resolved.continue.cooldownMs,
    factor: resolved.continue.backoffFactor,
    capMs: resolved.continue.backoffCapMs,
  }
}

/**
 * Whether a module is enabled per the resolved configuration.
 * @param resolved - the resolved configuration tree.
 * @param moduleId - the module to query.
 * @returns true when the module is enabled.
 */
export function moduleEnabled(resolved: ResolvedDefaults, moduleId: ModuleId): boolean {
  switch (moduleId) {
    case 'continue':
      return resolved.continue.enabled
    case 'guard':
      return resolved.guard.enabled
    case 'review':
      return resolved.review.enabled
    default:
      return false
  }
}
