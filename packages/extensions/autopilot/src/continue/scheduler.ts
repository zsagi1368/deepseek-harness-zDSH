/**
 * ContinueScheduler — per-session state machine for auto-resume.
 *
 * Two-gate discipline: conditions are checked when the grace timer is armed
 * AND again when it fires (config and pause state may change inside the
 * window). Cross-module gates (pause / pending approval / circuit) live in the
 * coordinator and are consulted through `requestResume`, which returns the
 * dispatch outcome so a DEFERRED result reschedules instead of dropping.
 *
 * The scheduler never sends by itself: `adapters.sendFollowup` performs the
 * side effect after `beginAttempt` has booked the attempt.
 */
import type { DispatchOutcome } from '../kernel/coordinator.js'
import type { Clock, RandomSource } from '../kernel/ledger.js'
import { effectiveCooldown } from '../kernel/ledger.js'
import type { BackoffParams } from '../kernel/ledger.js'
import type {
  ApResumedPayload,
  ApSkippedPayload,
} from '../kernel/types.js'
import type { LoopGuard } from './loopguard.js'

/** Host adapter surface the scheduler drives: gating, sending, timers, audit. */
export interface SchedulerAdapters {
  /** Ask the kernel coordinator to gate and route this resume request. */
  requestResume(sessionId: string): DispatchOutcome[]
  /** Perform the actual followup send. Returns false when no live agent exists. */
  sendFollowup(sessionId: string, text: string, template: 'continue' | 'continue-max-tokens' | 'loop'): boolean
  setTimeoutMs(fn: () => void, ms: number): () => void
  auditResumed(payload: ApResumedPayload): void
  auditSkipped(payload: ApSkippedPayload): void
}

interface SessionState {
  pendingTimer?: { cancel: () => void; template: 'continue' | 'continue-max-tokens' }
  pausedUntil: number
}

/** Per-session auto-resume state machine with two-gate discipline. */
export class ContinueScheduler {
  private sessions = new Map<string, SessionState>()

  constructor(
    private readonly adapters: SchedulerAdapters,
    private readonly clock: Clock,
    private readonly rng: RandomSource,
    private readonly ledgerHub: {
      session(id: string, backoff: BackoffParams): {
        beginAttempt(now: number): number
        inCooldown(now: number): boolean
        consecutive: number
        noteRecovery(): void
        noteUserMessage(): void
      }
    },
    private readonly backoff: BackoffParams,
    private readonly limits: { graceMs: number; maxConsecutive: number },
  ) {}

  // ------------------------------------------------------------------
  // State transitions
  // ------------------------------------------------------------------

  /**
   * Advance the session into a new turn, cancelling any pending resume.
   * @param sessionId - the session that started a turn.
   */
  beginTurn(sessionId: string): void {
    this.cancelPending(sessionId) // host healed itself — cancel quietly
  }

  /**
   * Record a user message, cancelling pending resumes for the session.
   * @param sessionId - the session the user wrote into.
   */
  noteUserMessage(sessionId: string): void {
    this.cancelPending(sessionId)
    this.ledgerHub.session(sessionId, this.backoff).noteUserMessage()
  }

  /**
   * Pause the session's auto-resume for the given duration.
   * @param sessionId - the session to pause.
   * @param durationMs - how long the pause lasts.
   */
  pauseSession(sessionId: string, durationMs: number): void {
    const state = this.stateFor(sessionId)
    state.pausedUntil = this.clock.now() + durationMs
    this.cancelPending(sessionId)
  }

  /**
   * Lift a previously applied pause for the session.
   * @param sessionId - the session to resume.
   */
  resumeSession(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (state) state.pausedUntil = 0
  }

  /**
   * Explicit human action — bypasses every gate except "agent exists".
   * @param sessionId - the session to resume now.
   * @param text - the followup text to send.
   * @returns whether the followup was actually sent.
   */
  resumeNow(sessionId: string, text: string): boolean {
    return this.adapters.sendFollowup(sessionId, text, 'continue')
  }

  /**
   * Cancel the session's pending resume timer, if any.
   * @param sessionId - the session to cancel.
   */
  cancelPending(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (state?.pendingTimer) {
      state.pendingTimer.cancel()
      delete state.pendingTimer
    }
  }

  /**
   * Drop all scheduler state for a closed session.
   * @param sessionId - the session being closed.
   */
  closeSession(sessionId: string): void {
    this.cancelPending(sessionId)
    this.sessions.delete(sessionId)
  }

  // ------------------------------------------------------------------
  // Scheduling
  // ------------------------------------------------------------------

  /**
   * Called after the detector decided a turn is resume-worthy.
   * Returns true when a grace timer was armed.
   * @param sessionId - the session to schedule a resume for.
   * @param template - which resume template the followup should use.
   * @param buildText - builds the followup text when the grace timer fires.
   * @returns true when a grace timer was armed.
   */
  schedule(
    sessionId: string,
    template: 'continue' | 'continue-max-tokens',
    buildText: () => string,
  ): boolean {
    if (!this.gateLocal(sessionId)) {
      this.adapters.auditSkipped({ sessionId, reason: this.localSkipReason(sessionId) })
      return false
    }
    const state = this.stateFor(sessionId)
    if (state.pendingTimer) return false // one pending resume per session

    const timer = this.adapters.setTimeoutMs(() => {
      delete state.pendingTimer
      this.fire(sessionId, template, buildText)
    }, this.limits.graceMs)
    state.pendingTimer = { cancel: timer, template }
    return true
  }

  private fire(
    sessionId: string,
    template: 'continue' | 'continue-max-tokens',
    buildText: () => string,
  ): void {
    // Second gate — identical checks, because the world changed during grace.
    if (!this.gateLocal(sessionId)) {
      this.adapters.auditSkipped({ sessionId, reason: this.localSkipReason(sessionId) })
      return
    }
    const ledger = this.ledgerHub.session(sessionId, this.backoff)
    if (ledger.consecutive >= this.limits.maxConsecutive) {
      this.adapters.auditSkipped({ sessionId, reason: 'consecutive-limit' })
      return
    }
    if (ledger.inCooldown(this.clock.now())) {
      this.adapters.auditSkipped({ sessionId, reason: 'cooldown' })
      return
    }

    // Cross-module gates: coordinator may suppress or defer.
    const outcomes = this.adapters.requestResume(sessionId)
    const verdict = outcomes.find(o => o.status !== 'dispatched') ?? outcomes[0]
    if (verdict?.status === 'deferred') {
      // Re-arm shortly; do not burn cooldown for a deferred attempt.
      const retryAt = Math.min(60_000, this.limits.graceMs * 2)
      const state = this.stateFor(sessionId)
      const timer = this.adapters.setTimeoutMs(() => {
        delete state.pendingTimer
        this.fire(sessionId, template, buildText)
      }, retryAt)
      state.pendingTimer = { cancel: timer, template }
      return
    }
    if (verdict && verdict.status !== 'dispatched') {
      this.adapters.auditSkipped({ sessionId, reason: verdict.reason ?? 'paused' })
      return
    }

    // Book BEFORE the side effect; failures consume the attempt too.
    const backoffApplied = ledger.beginAttempt(this.clock.now())
    const sent = this.adapters.sendFollowup(sessionId, buildText(), template)
    if (!sent) {
      this.adapters.auditSkipped({ sessionId, reason: 'no-agent' })
      return
    }
    this.adapters.auditResumed({
      sessionId,
      attempt: ledger.consecutive,
      template,
      backoffMs: backoffApplied,
    })
  }

  /**
   * Recovery bookkeeping after an assistant turn completes successfully.
   * @param sessionId - the session that recovered.
   */
  noteRecoveredTurn(sessionId: string): void {
    this.ledgerHub.session(sessionId, this.backoff).noteRecovery()
  }

  /**
   * How long until the session may be resumed, per its backoff cooldown.
   * @param sessionId - the session to query.
   * @param loopGuard - reserved for the loop-guard tie-in.
   * @returns the effective cooldown in milliseconds.
   */
  nextReadyIn(sessionId: string, loopGuard: LoopGuard): number {
    void loopGuard
    const ledger = this.ledgerHub.session(sessionId, this.backoff)
    return effectiveCooldown(Math.max(0, ledger.consecutive - 1), this.backoff)
  }

  /**
   * Generate a unique attempt id for audit records.
   * @returns the new attempt id.
   */
  makeAttemptId(): string {
    return `att_${this.clock.now().toString(36)}_${this.rng.token()}`
  }

  private stateFor(sessionId: string): SessionState {
    let state = this.sessions.get(sessionId)
    if (!state) {
      state = { pausedUntil: 0 }
      this.sessions.set(sessionId, state)
    }
    return state
  }

  private gateLocal(sessionId: string): boolean {
    const state = this.sessions.get(sessionId)
    if (state?.pausedUntil && this.clock.now() < state.pausedUntil) return false
    if (state?.pendingTimer) return false
    return true
  }

  private localSkipReason(sessionId: string) {
    const state = this.sessions.get(sessionId)
    if (state?.pausedUntil && this.clock.now() < state.pausedUntil) {
      return 'session-paused' as const
    }
    return 'cooldown' as const
  }
}
