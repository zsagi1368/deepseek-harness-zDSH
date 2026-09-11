/**
 * Workbench client half entry. Provides the panel/command registry as a
 * cordis service so any other browser plugin can `inject: ['workbench']` and
 * extend the shell through the same api the built-ins use, then mounts the
 * dock (self-attached React root; no host layout slot dependency).
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the locale plugin's Context merge (ctx.locale) for the
// dictionary registration below — no runtime edge to dsh-client-locale.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { WORKBENCH_VERSION } from '../shared/protocol.ts'
import type { WorkbenchRegistryApi } from './registry.ts'
import { createWorkbenchRegistry } from './registry.ts'
import { setCollapsed, togglePalette } from './shell/events.ts'
import { WORKBENCH_NS, en, zh, type WorkbenchKey } from './locales.ts'
import { mountDock } from './shell/mount.tsx'
import { loadPrefs, savePrefs } from './shell/prefs.ts'
import { registerFilesFeature } from './panels/files/register-files.tsx'
import { registerBrowseFeature } from './panels/browse/register-browse.tsx'
import { registerGitFeature } from './panels/git/register-git.tsx'
import { registerTasksFeature } from './panels/tasks/register-tasks.tsx'
import { registerTerminalFeature } from './panels/terminal/register-terminal.tsx'

export { createWorkbenchRegistry } from './registry.ts'
export type { CommandDescriptor, PanelDescriptor, RegisteredPanel, WorkbenchRegistryApi } from './registry.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    workbench: WorkbenchRegistryApi
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Workbench dock, palette, panels, and views. */
    'workbench': WorkbenchKey
  }
}

/** Built-ins register through the same public api third parties use. */
function wireBuiltInCommands(registry: WorkbenchRegistryApi): () => void {
  const disposers = [
    registry.registerCommand({ id: 'workbench:palette', title: '工作台：打开命令面板', titleKey: 'cmdOpenPalette', run: togglePalette }),
    registry.registerCommand({ id: 'workbench:collapse', title: '工作台：折叠侧栏', titleKey: 'cmdCollapse', run: () =>{  setCollapsed(true) } }),
    registry.registerCommand({ id: 'workbench:expand', title: '工作台：展开侧栏', titleKey: 'cmdExpand', run: () =>{  setCollapsed(false) } }),
  ]
  return () => {
    for (const dispose of disposers) dispose()
  }
}

export function apply(ctx: Context): void {
  const registry = createWorkbenchRegistry(WORKBENCH_VERSION)
  ctx.provide('workbench', registry)

  const disposeCommands = wireBuiltInCommands(registry)
  const disposeFiles = registerFilesFeature(registry)
  const disposeTerminal = registerTerminalFeature(registry)
  const disposeGit = registerGitFeature(registry)
  const disposeTasks = registerTasksFeature(registry)
  const disposeBrowse = registerBrowseFeature(registry)

  if (typeof document === 'undefined') {
    // Node/test or non-DOM surface: the service contract still loads.
    ctx.effect(() => disposeCommands)
    return
  }

  ctx.effect(() => ctx.locale.register(WORKBENCH_NS, { zh, en }), 'workbench: dictionaries')
  const t = ctx.locale.bind(WORKBENCH_NS)

  const dock = mountDock(registry, {
    translate: t,
    onPrefsChange(next) {
      savePrefs(window.localStorage, next)
      dock.applyPrefs(next)
    },
  })
  // Re-apply stored prefs on boot so a disabled hotkey stays disabled even
  // though mountDock's initial attach already read the same store.
  dock.applyPrefs(loadPrefs(window.localStorage))
  ctx.effect(() => () => {
    dock.dispose()
    disposeBrowse()
    disposeTasks()
    disposeGit()
    disposeTerminal()
    disposeFiles()
    disposeCommands()
  }, 'workbench: dock mount')
}
