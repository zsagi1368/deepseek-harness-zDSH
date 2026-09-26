/** Window-level event vocabulary between the entry wiring and the shell. */

export const PALETTE_TOGGLE_EVENT = 'zdsh-workbench:toggle-palette'
/** Window event name for the palette toggle. */
export const SET_COLLAPSED_EVENT = 'zdsh-workbench:set-collapsed'

/** Dispatch the window-level palette toggle event (no-op without a window). */
export function togglePalette(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PALETTE_TOGGLE_EVENT))
}

/**
 * Dispatch the window-level collapse event with the new state (no-op without a window).
 * @param collapsed - the collapsed state to publish.
 */
export function setCollapsed(collapsed: boolean): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SET_COLLAPSED_EVENT, { detail: collapsed }))
  }
}
