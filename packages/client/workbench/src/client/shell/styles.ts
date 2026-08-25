/**
 * Dock shell styling. Injected once as a <style> element at mount so the
 * plugin ships zero CSS build-chain complexity and works identically on any
 * DSH surface that can load a client half.
 *
 * The dock docks to the right edge of the viewport, above the page in the
 * stacking order but below native dialogs; the command palette floats.
 */
export const WORKBENCH_STYLE_ID = 'zdsh-workbench-styles'

/** id of the dock root element the workbench mounts into. */
export const DOCK_CONTAINER_ID = 'zdsh-workbench-dock-root'

/** Full CSS text for the dock, palette, and theme tokens; injected once as a <style> element. */
export const WORKBENCH_STYLES = `
#zdsh-workbench-dock-root {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  z-index: 9000;
  font-family: inherit;
  font-size: 13px;
  color: var(--zdsh-wb-fg);
  background: var(--zdsh-wb-bg);
  border-left: 1px solid var(--zdsh-wb-border);
  display: flex;
  flex-direction: column;
  min-width: 220px;
}
.zdsh-wb-collapsed {
  min-width: 0;
}
.zdsh-wb-rail {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 6px;
  height: 34px;
  border-bottom: 1px solid var(--zdsh-wb-border);
  overflow-x: auto;
  scrollbar-width: thin;
  flex: none;
}
.zdsh-wb-tab {
  appearance: none;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  padding: 4px 8px;
  border-radius: 6px;
  cursor: pointer;
  white-space: nowrap;
}
.zdsh-wb-tab:hover { background: var(--zdsh-wb-hover); }
.zdsh-wb-tab[aria-selected="true"] {
  background: var(--zdsh-wb-active);
  font-weight: 600;
}
.zdsh-wb-spacer { flex: 1 1 auto; }
.zdsh-wb-iconbtn {
  appearance: none;
  border: none;
  background: transparent;
  color: inherit;
  font-size: 14px;
  line-height: 1;
  padding: 5px 7px;
  border-radius: 6px;
  cursor: pointer;
}
.zdsh-wb-iconbtn:hover { background: var(--zdsh-wb-hover); }
.zdsh-wb-body {
  flex: 1 1 auto;
  overflow: auto;
  padding: 8px;
}
.zdsh-wb-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  gap: 6px;
  opacity: 0.75;
  text-align: center;
}
.zdsh-wb-plusmenu {
  position: absolute;
  top: 36px;
  left: 6px;
  min-width: 180px;
  max-height: 60vh;
  overflow: auto;
  background: var(--zdsh-wb-bg);
  border: 1px solid var(--zdsh-wb-border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  padding: 4px;
  z-index: 2;
}
.zdsh-wb-menuitem {
  display: block;
  width: 100%;
  text-align: left;
  appearance: none;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  padding: 6px 10px;
  border-radius: 6px;
  cursor: pointer;
}
.zdsh-wb-menuitem:hover:not(:disabled) { background: var(--zdsh-wb-hover); }
.zdsh-wb-menuitem:disabled { opacity: 0.45; cursor: default; }
.zdsh-wb-resizer {
  position: absolute;
  top: 0;
  left: -3px;
  width: 6px;
  height: 100%;
  cursor: col-resize;
  touch-action: none;
  z-index: 3;
}
.zdsh-wb-palette-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 9500;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  padding-top: 12vh;
}
.zdsh-wb-palette {
  width: min(520px, 92vw);
  background: var(--zdsh-wb-bg);
  color: var(--zdsh-wb-fg);
  border: 1px solid var(--zdsh-wb-border);
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}
.zdsh-wb-palette input {
  width: 100%;
  box-sizing: border-box;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  font: inherit;
  padding: 12px 14px;
  border-bottom: 1px solid var(--zdsh-wb-border);
}
.zdsh-wb-palette ul {
  list-style: none;
  margin: 0;
  padding: 4px;
  max-height: 46vh;
  overflow: auto;
}
.zdsh-wb-orphan {
  padding: 16px;
  text-align: center;
  opacity: 0.8;
}

/* Theme tokens: follow the host light/dark class when present, fall back
   to neutral values that stay readable on either. */
#zdsh-workbench-dock-root, .zdsh-wb-palette {
  --zdsh-wb-bg: #ffffff;
  --zdsh-wb-fg: #1f2328;
  --zdsh-wb-border: #d0d7de;
  --zdsh-wb-hover: rgba(31, 35, 40, 0.08);
  --zdsh-wb-active: rgba(9, 105, 218, 0.15);
}
html.dark #zdsh-workbench-dock-root,
html.dark .zdsh-wb-palette,
body.dark #zdsh-workbench-dock-root,
body.dark .zdsh-wb-palette {
  --zdsh-wb-bg: #0d1117;
  --zdsh-wb-fg: #e6edf3;
  --zdsh-wb-border: #30363d;
  --zdsh-wb-hover: rgba(230, 237, 243, 0.1);
  --zdsh-wb-active: rgba(56, 139, 253, 0.25);
}

/* Narrow viewports: the dock becomes a full-width drawer and the drag
   handle disappears (touch users collapse via the rail button). */
@media (max-width: 767px) {
  #zdsh-workbench-dock-root {
    left: 0;
    min-width: 0;
    width: 100vw;
    border-left: none;
    box-shadow: 0 -4px 24px rgba(0, 0, 0, 0.35);
  }
  #zdsh-workbench-dock-root .zdsh-wb-resizer {
    display: none;
  }
}
`
