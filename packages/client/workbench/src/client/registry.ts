/**
 * Workbench panel registry, the client-half extension surface. Pure data:
 * no React, no DOM, no cordis — so tests and future hosts can drive it
 * directly. Everything the workbench ships (and everything third-party code
 * registers) goes through THIS api; the shell renders only what is here.
 *
 * Lifecycle contract: registerX returns a disposer. Callers must wrap
 * registration in their fiber/effect lifecycle so disposers run on unload;
 * registering a duplicate id throws loudly instead of silently shadowing.
 */

/** A page that can be opened inside the dock or bottom panel. */
export interface PanelDescriptor {
  /** Globally unique id; convention `provider:panel`. */
  id: string
  /** Display title for third-party callers; built-ins pass `titleKey` instead. */
  title?: string
  /** Locale dictionary key rendered instead of `title` when set (built-ins); third parties keep `title`. */
  titleKey?: import('./locales.ts').WorkbenchKey
  /** `+` menu ordering, ascending; lower comes first. Default 100. */
  order?: number
  /**
   * Content component contribution. Omitting it renders a placeholder body;
   * the component receives shell actions through props: `visible` is false
   * whenever its tab is not the active one (pause polling), `openPanel`
   * focuses or opens another registered panel, and `close` closes this tab.
   */
  component?: (props: PanelComponentProps) => import('react').ReactNode
}

/** Props the shell hands to every rendered panel component. */
export interface PanelComponentProps {
  visible: boolean
  openPanel: (panelId: string) => void
  close: () => void
}

/** A panel registration snapshot: descriptor plus the resolved `order` value. */
export interface RegisteredPanel extends PanelDescriptor {
  readonly order: number
}

/** A named, invocable action surfaced in the command palette. */
export interface CommandDescriptor {
  /** Globally unique id; convention `provider:command`. */
  id: string
  /** Palette display title for third-party callers; built-ins pass `titleKey` instead. */
  title?: string
  /** Locale dictionary key rendered instead of `title` when set (built-ins). */
  titleKey?: import('./locales.ts').WorkbenchKey
  run: () => void
}

/** The registry face other modules receive via injection. */
export interface WorkbenchRegistryApi {
  /**
   * Register a panel type; duplicate ids throw.
   * @param descriptor - panel id, display copy, ordering, and content component.
   * @returns the registration's disposer.
   */
  registerPanel(descriptor: PanelDescriptor): () => void
  /** Current registration snapshot, ordered by `order` then registration sequence.
   * @returns the panel registrations, in display order. */
  getPanels(): readonly RegisteredPanel[]
  /**
   * Register a palette command; duplicate ids throw.
   * @param descriptor - command id, display copy, and action.
   * @returns the registration's disposer.
   */
  registerCommand(descriptor: CommandDescriptor): () => void
  /** Current command snapshot, ordered by registration sequence.
   * @returns the command registrations, in registration order. */
  getCommands(): readonly CommandDescriptor[]
  /**
   * Subscribe to registration changes; the listener fires after each change.
   * @param listener - callback invoked after every registration change.
   * @returns the subscription's unsubscribe disposer.
   */
  subscribe(listener: () => void): () => void
  /** Plugin version this registry serves; consumers gate new api on it. */
  readonly version: string
  /**
   * Monotonic capability vocabulary (`only ever grows`). Consumers check
   * membership instead of comparing versions so old hosts degrade cleanly.
   */
  readonly features: readonly string[]
}

const REGISTRY_FEATURES: readonly string[] = ['panels', 'commands'] as const

class RegistrationError extends Error {
  constructor(kind: string, id: string) {
    super(`workbench: duplicate ${kind} id "${id}"`)
    this.name = 'RegistrationError'
  }
}

function createIdMapStore<T>(kind: string) {
  const items = new Map<string, { value: T; seq: number }>()
  let nextSeq = 0
  return {
    add(id: string, value: T): void {
      if (items.has(id)) throw new RegistrationError(kind, id)
      items.set(id, { value, seq: nextSeq++ })
    },
    remove(id: string): boolean {
      return items.delete(id)
    },
    list(): Array<{ value: T; seq: number }> {
      return [...items.values()].sort((a, b) => a.seq - b.seq)
    },
    has(id: string): boolean {
      return items.has(id)
    },
  }
}

/**
 * Create the workbench registry serving the given plugin version.
 * @param version - plugin version the registry reports to consumers.
 * @returns the registry API face for registration and snapshot reads.
 */
export function createWorkbenchRegistry(version: string): WorkbenchRegistryApi {
  const panels = createIdMapStore<RegisteredPanel>('panel')
  const commands = createIdMapStore<CommandDescriptor>('command')
  const listeners = new Set<() => void>()

  // Snapshot caches: useSyncExternalStore requires getSnapshot to return a
  // reference-stable value between changes, so derived arrays are rebuilt
  // only after a mutation marks them dirty.
  let panelsDirty = true
  let panelsCache: readonly RegisteredPanel[] = []
  let commandsDirty = true
  let commandsCache: readonly CommandDescriptor[] = []

  const announce = (): void => {
    for (const listener of listeners) listener()
  }

  const markChanged = (): void => {
    panelsDirty = true
    commandsDirty = true
    announce()
  }

  return {
    version,
    features: REGISTRY_FEATURES,
    registerPanel(descriptor) {
      const registered: RegisteredPanel = { ...descriptor, order: descriptor.order ?? 100 }
      panels.add(registered.id, registered)
      markChanged()
      return () => {
        // Disposing an already-disposed registration stays a no-op so
        // double teardown (manual + fiber) never throws.
        if (!panels.remove(registered.id)) return
        markChanged()
      }
    },
    getPanels() {
      if (panelsDirty) {
        panelsCache = panels
          .list()
          .sort((a, b) => a.value.order - b.value.order || a.seq - b.seq)
          .map(entry => entry.value)
        panelsDirty = false
      }
      return panelsCache
    },
    registerCommand(descriptor) {
      commands.add(descriptor.id, { ...descriptor })
      markChanged()
      return () => {
        if (!commands.remove(descriptor.id)) return
        markChanged()
      }
    },
    getCommands() {
      if (commandsDirty) {
        commandsCache = commands.list().map(entry => entry.value)
        commandsDirty = false
      }
      return commandsCache
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}
