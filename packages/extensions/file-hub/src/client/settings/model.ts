/**
 * Pure form state machine for the FileHub settings panel (FR-E5'): dirty
 * tracking, save lifecycle, and reset — no React, no fetch, so the whole
 * machine unit-tests synchronously (tests/client/settings-model.test.ts).
 *
 * The wire shape mirrors src/server/settings.ts (type-only import — erased at
 * build time, so no server code enters the browser bundle). Defaults are
 * redeclared locally because importing the server's runtime constant would
 * drag zod into the client bundle.
 */

import type { FileHubSettings } from '../../server/settings.js'

/** Client copy of FILEHUB_SETTINGS_DEFAULTS (server owns normalization). */
export const SETTINGS_DEFAULTS: Readonly<FileHubSettings> = Object.freeze({
  enabled: true,
  ignorePastedMentions: false,
  'candidates.max': 20,
  'console.defaultView': 'grouped',
  'privacy.localFirstVision': true,
  'vision.mode': 'caption',
})

/** Save-lifecycle status of the settings form. */
export type SettingsSaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/** One snapshot of the settings form: working copy, saved baseline, and save status. */
export interface SettingsFormState {
  /** Editable working copy. */
  readonly values: FileHubSettings
  /** Last successfully persisted snapshot (the dirty baseline). */
  readonly savedValues: FileHubSettings
  readonly status: SettingsSaveStatus
  readonly errorMessage?: string | undefined
}

/**
 * Field-by-field equality of two settings records.
 * @param a - first settings record.
 * @param b - second settings record.
 * @returns true when every known setting matches.
 */
export function settingsEqual(a: FileHubSettings, b: FileHubSettings): boolean {
  return (
    a.enabled === b.enabled &&
    a.ignorePastedMentions === b.ignorePastedMentions &&
    a['candidates.max'] === b['candidates.max'] &&
    a['console.defaultView'] === b['console.defaultView'] &&
    a['privacy.localFirstVision'] === b['privacy.localFirstVision'] &&
    a['vision.mode'] === b['vision.mode']
  )
}

/**
 * Whether the working copy diverges from the last persisted snapshot.
 * @param state - the form state to test.
 * @returns true when at least one setting is unsaved.
 */
export function isDirty(state: SettingsFormState): boolean {
  return !settingsEqual(state.values, state.savedValues)
}

/**
 * Build a fresh form state around the initial record.
 * @param initial - the starting settings (baseline and working copy).
 * @returns an idle form state.
 */
export function createSettingsForm(initial: FileHubSettings): SettingsFormState {
  return { values: { ...initial }, savedValues: { ...initial }, status: 'idle' }
}

/** One editable settings key. */
export type SettingsValueKey = keyof FileHubSettings

/**
 * Apply one field edit; clears stale error/saved flashes.
 * @param state - the current form state.
 * @param key - the setting key to edit.
 * @param value - the new value for that key.
 * @returns the next form state (same reference when the value is unchanged).
 */
export function editValue<K extends SettingsValueKey>(
  state: SettingsFormState,
  key: K,
  value: FileHubSettings[K],
): SettingsFormState {
  if (state.values[key] === value) return state
  return { ...state, values: { ...state.values, [key]: value }, status: 'idle', errorMessage: undefined }
}

/**
 * Mark a save as in flight.
 * @param state - the current form state.
 * @returns the next state with status 'saving'.
 */
export function beginSave(state: SettingsFormState): SettingsFormState {
  return { ...state, status: 'saving', errorMessage: undefined }
}

/**
 * Persisted OK: advance the dirty baseline and flash success.
 * @param state - the current form state.
 * @param persisted - the settings record the server acknowledged.
 * @returns the next state with an updated baseline and status 'saved'.
 */
export function saveSucceeded(
  state: SettingsFormState,
  persisted: FileHubSettings,
): SettingsFormState {
  return { ...state, savedValues: { ...persisted }, status: 'saved' }
}

/**
 * Persisted failed: keep the edits, surface the reason.
 * @param state - the current form state.
 * @param message - the failure reason to display.
 * @returns the next state with status 'error' and the message attached.
 */
export function saveFailed(state: SettingsFormState, message: string): SettingsFormState {
  return { ...state, status: 'error', errorMessage: message }
}

/**
 * Restore values (defaults or a reloaded record) WITHOUT persisting — the
 * dirty baseline moves too, since restore is an explicit user act.
 * @param state - the current form state.
 * @param values - the record to restore (defaults or a reloaded record).
 * @returns the next state with both copies replaced and status 'idle'.
 */
export function resetValues(state: SettingsFormState, values: FileHubSettings): SettingsFormState {
  return { ...state, values: { ...values }, savedValues: { ...values }, status: 'idle', errorMessage: undefined }
}
