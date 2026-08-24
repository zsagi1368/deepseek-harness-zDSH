/** Window-level event vocabulary between the entry wiring and the shell. */

export const PALETTE_TOGGLE_EVENT = 'zdsh-workbench:toggle-palette'
export const SET_COLLAPSED_EVENT = 'zdsh-workbench:set-collapsed'

export function togglePalette(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PALETTE_TOGGLE_EVENT))
}

export function setCollapsed(collapsed: boolean): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SET_COLLAPSED_EVENT, { detail: collapsed }))
  }
}
