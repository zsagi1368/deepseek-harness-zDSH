/**
 * AutomationCoordinator — the single subscription point and cross-module
 * referee.
 *
 * Invariants enforced here (modules never re-implement them):
 *  1. A session with a pending approval defers auto-resume (deferred, not
 *     dropped — the module reschedules).
 *  2. An open review circuit suppresses auto-resume (skipped: circuit-open).
 *  3. Global pause stops all modules.
 *  4. One approval callId is dispositioned exactly once (first claim wins).
 */
import type { ModuleId, SkipReason } from './types.js'

// ---------------------------------------------------------------------------
// Event vocabulary crossing the kernel
// ---------------------------------------------------------------------------

/** Event vocabulary crossing the kernel coordination boundary. */
export type CoordinationEvent =
  | { kind: 'turn-ended'; sessionId: string; reason: string }
  | { kind: 'approval-pending'; sessionId: string; callId: string; toolName: string }
  | { kind: 'approval-resolved'; sessionId: string; callId: string }
  | { kind: 'resume-request'; sessionId: string }
  | { kind: 'circuit-change'; open: boolean }
  | { kind: 'pause-change'; paused: boolean }

/** How a dispatch of one event to one module resolved. */
export type DispatchStatus = 'dispatched' | 'suppressed' | 'deferred' | 'duplicate'

/** One dispatch result plus the reason when it was not dispatched. */
export interface DispatchOutcome {
  status: DispatchStatus
  /** Populated when status is suppressed/deferred. */
  reason?: SkipReason
}

// ---------------------------------------------------------------------------
// Module handler surface
// ---------------------------------------------------------------------------

/** Read-only view of coordinator state handed to module handlers. */
export interface CoordinationView {
  readonly paused: boolean
  readonly circuitOpen: boolean
  hasPendingApproval(sessionId: string): boolean
  /** Claim a call for disposition. First caller wins; losers get false. */
  claimCall(callId: string): boolean
}

/** Module handler callback surface for coordination events. */
export type CoordinationHandler = (event: CoordinationEvent, view: CoordinationView) => void

/** Single subscription point and cross-module referee (see module header). */
export class AutomationCoordinator {
  private handlers = new Map<ModuleId, { handler: CoordinationHandler; enabled: boolean }>()
  private pendingBySession = new Map<string, Set<string>>()
  private claimedCalls = new Set<string>()
  /** Internal mutable twin of the readonly view handed to modules. */
  private readonly view: { -readonly [K in keyof CoordinationView]: CoordinationView[K] } = {
    paused: false,
    circuitOpen: false,
    hasPendingApproval: sessionId => (this.pendingBySession.get(sessionId)?.size ?? 0) > 0,
    claimCall: (callId) => {
      if (this.claimedCalls.has(callId)) return false
      this.claimedCalls.add(callId)
      return true
    },
  }

  /**
   * Register a module's coordination handler.
   * @param moduleId - the module id.
   * @param handler - the handler invoked for every dispatched event.
   */
  registerModule(moduleId: ModuleId, handler: CoordinationHandler): void {
    this.handlers.set(moduleId, { handler, enabled: true })
  }

  /**
   * Enable or disable dispatch to a module.
   * @param moduleId - the module id.
   * @param enabled - whether the module receives events.
   */
  setModuleEnabled(moduleId: ModuleId, enabled: boolean): void {
    const entry = this.handlers.get(moduleId)
    if (entry) entry.enabled = enabled
  }

  /**
   * Set the global pause state.
   * @param paused - whether automation is paused.
   */
  setPaused(paused: boolean): void {
    this.view.paused = paused
  }

  /**
   * Set the review-circuit state.
   * @param open - whether the circuit is open.
   */
  setCircuitOpen(open: boolean): void {
    this.view.circuitOpen = open
  }

  /** Whether automation is globally paused. */
  get paused(): boolean {
    return this.view.paused
  }

  /** Whether the review circuit is currently open. */
  get circuitOpen(): boolean {
    return this.view.circuitOpen
  }

  /**
   * Dispatch one event: maintain state, gate resume requests centrally, then
   * fan out to every enabled module.
   * @param event - the coordination event to dispatch.
   * @returns one outcome per enabled module (plus the central gate verdict).
   */
  dispatch(event: CoordinationEvent): DispatchOutcome[] {
    // State maintenance first.
    switch (event.kind) {
      case 'approval-pending': {
        let set = this.pendingBySession.get(event.sessionId)
        if (!set) {
          set = new Set()
          this.pendingBySession.set(event.sessionId, set)
        }
        set.add(event.callId)
        break
      }
      case 'approval-resolved': {
        const set = this.pendingBySession.get(event.sessionId)
        set?.delete(event.callId)
        break
      }
      case 'pause-change':
        this.setPaused(event.paused)
        break
      case 'circuit-change':
        this.setCircuitOpen(event.open)
        break
      default:
        break
    }

    // Gate resume requests centrally.
    if (event.kind === 'resume-request') {
      if (this.view.paused) return [{ status: 'suppressed', reason: 'paused' }]
      if ((this.pendingBySession.get(event.sessionId)?.size ?? 0) > 0) {
        return [{ status: 'deferred', reason: 'pending-approval' }]
      }
      if (this.view.circuitOpen) {
        return [{ status: 'suppressed', reason: 'circuit-open' }]
      }
    }

    // Fan out to every enabled module.
    const outcomes: DispatchOutcome[] = []
    for (const entry of this.handlers.values()) {
      if (!entry.enabled) continue
      try {
        entry.handler(event, this.view)
        outcomes.push({ status: 'dispatched' })
      } catch {
        // Handler failures must not break the fanout for other modules;
        // module-internal failure mapping owns the audit trail.
        outcomes.push({ status: 'suppressed', reason: 'unavailable' })
      }
    }
    if (outcomes.length === 0 && event.kind === 'resume-request') {
      return [{ status: 'dispatched' }]
    }
    return outcomes.length > 0 ? outcomes : [{ status: 'dispatched' }]
  }
}
