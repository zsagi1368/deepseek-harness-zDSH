/**
 * Workbench locale dictionaries, keyed by the {@link WorkbenchKey} union the
 * shell and panel components render. The workbench mounts its own React root
 * instead of occupying a host slot, so components receive copy through the
 * {@link WorkbenchLocale} context fed by the plugin body (which binds the
 * shared `LocaleRuntime`): see `context.tsx` and `apply` in `index.ts`.
 *
 * Both languages must stay key-symmetric — `scripts/locale-dictionary-parity.spec.ts`
 * fails on asymmetry — and every product-visible string in `src/client` must
 * come from here (`pnpm run verify-client-ui-i18n`).
 */

/** Locale keys the workbench surfaces render. */
export type WorkbenchKey =
  // shell / dock chrome
  | 'dockTitle' | 'dockEmptyHint' | 'openPanelsHint' | 'panelProviderMissingBefore' | 'panelProviderMissingAfter'
  | 'closeTab' | 'noPanelsAvailable' | 'palettePlaceholder' | 'paletteAria' | 'paletteNoMatch'
  | 'noContent'
  | 'expandDock' | 'collapseDock' | 'openPanels' | 'openPalette' | 'dockSettings'
  | 'expandDockAria' | 'closeAria' | 'providerNotLoaded'
  // settings panel
  | 'settingsAria' | 'settingsTitle' | 'prefStartCollapsed' | 'prefPaletteHotkey' | 'done'
  // files panel
  | 'filesTitle' | 'filesViewGroup' | 'filesPickFromPanel' | 'workspaceRootPlaceholder' | 'open'
  | 'goUp' | 'refresh' | 'searchPlaceholder' | 'search' | 'cancel' | 'loading' | 'noMatches'
  | 'truncatedEntries' | 'filesEmptyHint' | 'bytesSuffix' | 'download' | 'binaryFileBefore' | 'binaryFileAfter'
  | 'downloadFile' | 'saveTitle' | 'saving' | 'saveDirty' | 'saved' | 'fileTooLarge' | 'markdownPending'
  // git panel
  | 'gitTitle' | 'gitRefresh' | 'gitFetch' | 'gitPull' | 'gitPush' | 'gitNeedsRoot' | 'commitPlaceholder'
  | 'commit' | 'collapseDiff' | 'viewDiff' | 'unstage' | 'stage' | 'historyShown' | 'historyHidden'
  // tasks panel
  | 'tasksTitle' | 'columnTodo' | 'columnInProgress' | 'columnDone' | 'newTaskPlaceholder' | 'deleteTask'
  // terminal panel
  | 'terminalTitle' | 'terminalNewTab' | 'terminalUnavailableBefore' | 'terminalUnavailableAfter' | 'restartTerminal'
  | 'terminalRepairCommand'
  // browse panel
  | 'browseTitle' | 'browseBlank' | 'newTab' | 'newTabTitle' | 'sandboxed' | 'urlPlaceholder' | 'go'
  | 'openInSystemBrowser' | 'browseEmptyHint' | 'browseSandboxBadge'
  | 'cmdOpenPalette' | 'cmdCollapse' | 'cmdExpand'

/** English copy. */
export const en: Record<WorkbenchKey, string> = {
  // shell / dock chrome
  dockTitle: 'zDSH Workbench',
  dockEmptyHint: 'No panels available.',
  openPanelsHint: 'Open panels from the top-right + menu.',
  panelProviderMissingBefore: 'Panel "',
  panelProviderMissingAfter: '" has no loaded provider.',
  closeTab: 'Close this tab',
  noPanelsAvailable: '(no panels available)',
  palettePlaceholder: 'Type a command… (Enter to run, Esc to close)',
  paletteAria: 'workbench command palette',
  paletteNoMatch: 'No matching command',
  noContent: 'This panel contributes no content component.',
  expandDock: 'Expand workbench',
  collapseDock: 'Collapse workbench',
  openPanels: 'Open panel (+)',
  openPalette: 'Command palette (Ctrl/Cmd+Shift+P)',
  dockSettings: 'Workbench settings',
  expandDockAria: 'expand workbench',
  closeAria: 'close',
  providerNotLoaded: '(provider not loaded)',
  // settings panel
  settingsAria: 'workbench settings',
  settingsTitle: 'Workbench settings',
  prefStartCollapsed: 'Collapse sidebar on start',
  prefPaletteHotkey: 'Enable Ctrl/Cmd+Shift+P hotkey',
  done: 'Done',
  // files panel
  filesTitle: 'Files',
  filesViewGroup: 'View',
  filesPickFromPanel: 'Pick a file from the Files panel.',
  workspaceRootPlaceholder: 'Workspace root (absolute path)',
  open: 'Open',
  goUp: 'Up one level',
  refresh: 'Refresh',
  searchPlaceholder: 'Search by name…',
  search: 'Search',
  cancel: 'Cancel',
  loading: 'Loading…',
  noMatches: 'No matching entries',
  truncatedEntries: 'Too many entries; showing a subset.',
  filesEmptyHint: 'Enter a workspace root and click "Open".',
  bytesSuffix: ' bytes)',
  download: 'Download',
  binaryFileBefore: 'Binary file (',
  binaryFileAfter: ' bytes); no inline renderer yet. ',
  downloadFile: 'Download file',
  saveTitle: 'Save (Ctrl/Cmd+S)',
  saving: 'Saving…',
  saveDirty: 'Save *',
  saved: 'Saved',
  fileTooLarge: 'File too large; showing the first half read-only.',
  markdownPending: 'Markdown rendered view arrives with the polish milestone.',
  // git panel
  gitTitle: 'Git',
  gitRefresh: 'Refresh',
  gitFetch: 'fetch',
  gitPull: 'pull',
  gitPush: 'push',
  gitNeedsRoot: 'Set a workspace root in the Files panel first',
  commitPlaceholder: 'Commit message… (Ctrl/Cmd+Enter to commit)',
  commit: '✓ Commit',
  collapseDiff: 'Collapse diff',
  viewDiff: 'View diff',
  unstage: 'Unstage',
  stage: 'Stage',
  historyShown: 'History ▸',
  historyHidden: 'History ▾',
  // tasks panel
  tasksTitle: 'Tasks',
  columnTodo: 'Todo',
  columnInProgress: 'In progress',
  columnDone: 'Done',
  newTaskPlaceholder: 'New task title… (Enter to add)',
  deleteTask: 'Delete',
  // terminal panel
  terminalTitle: 'Terminal',
  terminalNewTab: 'New terminal',
  terminalUnavailableBefore: 'Terminal unavailable (',
  terminalUnavailableAfter: ')',
  restartTerminal: 'Restart terminal',
  terminalRepairCommand: 'pnpm approve-builds --all && pnpm rebuild node-pty',
  // browse panel
  browseTitle: 'Browse',
  browseBlank: 'Blank page',
  newTab: 'New tab',
  newTabTitle: 'New tab',
  sandboxed: 'Content runs in an opaque-origin sandboxed iframe',
  urlPlaceholder: 'Search or enter URL (http/https)',
  go: 'Go',
  openInSystemBrowser: 'Open in system browser',
  browseEmptyHint: 'Enter a URL to start browsing.',
  browseSandboxBadge: 'Sandbox',
  cmdOpenPalette: 'Workbench: open command palette',
  cmdCollapse: 'Workbench: collapse sidebar',
  cmdExpand: 'Workbench: expand sidebar',
}

/** Chinese copy. */
export const zh: Record<WorkbenchKey, string> = {
  // shell / dock chrome
  dockTitle: 'zDSH 工作台',
  dockEmptyHint: '暂无可用面板。',
  openPanelsHint: '通过右上 ＋ 打开面板',
  panelProviderMissingBefore: '面板「',
  panelProviderMissingAfter: '」的提供者未加载。',
  closeTab: '关闭此页签',
  noPanelsAvailable: '（暂无可用面板）',
  palettePlaceholder: '输入命令名…（Enter 执行，Esc 关闭）',
  paletteAria: 'workbench command palette',
  paletteNoMatch: '没有匹配的命令',
  noContent: '该面板尚未提供内容组件。',
  expandDock: '展开工作台',
  collapseDock: '折叠工作台',
  openPanels: '打开面板（+）',
  openPalette: '命令面板（Ctrl/Cmd+Shift+P）',
  dockSettings: '工作台设置',
  expandDockAria: 'expand workbench',
  closeAria: 'close',
  providerNotLoaded: '（提供者未加载）',
  // settings panel
  settingsAria: 'workbench settings',
  settingsTitle: '工作台设置',
  prefStartCollapsed: '启动时折叠侧栏',
  prefPaletteHotkey: '启用 Ctrl/Cmd+Shift+P 热键',
  done: '完成',
  // files panel
  filesTitle: '文件',
  filesViewGroup: '查看',
  filesPickFromPanel: '从「文件」面板选择一个文件。',
  workspaceRootPlaceholder: '工作区根目录（绝对路径）',
  open: '打开',
  goUp: '上一级',
  refresh: '刷新',
  searchPlaceholder: '按名称搜索…',
  search: '搜索',
  cancel: '取消',
  loading: '加载中…',
  noMatches: '无匹配结果',
  truncatedEntries: '条目过多，仅显示部分。',
  filesEmptyHint: '输入工作区根目录并点击「打开」',
  bytesSuffix: ' 字节)',
  download: '下载',
  binaryFileBefore: '二进制文件（',
  binaryFileAfter: ' 字节），暂无内嵌渲染器。',
  downloadFile: '下载文件',
  saveTitle: '保存（Ctrl/Cmd+S）',
  saving: '保存中…',
  saveDirty: '保存 *',
  saved: '已保存',
  fileTooLarge: '文件过大，只读显示前半部分。',
  markdownPending: 'Markdown 渲染视图将在打磨里程碑接入。',
  // git panel
  gitTitle: 'Git',
  gitRefresh: '刷新',
  gitFetch: 'fetch',
  gitPull: 'pull',
  gitPush: 'push',
  gitNeedsRoot: '先在「文件」面板设置工作区根目录',
  commitPlaceholder: '提交说明…（Ctrl/Cmd+Enter 提交）',
  commit: '✓ 提交',
  collapseDiff: '收起差异',
  viewDiff: '查看差异',
  unstage: '取消暂存',
  stage: '暂存',
  historyShown: '历史 ▸',
  historyHidden: '历史 ▾',
  // tasks panel
  tasksTitle: '任务',
  columnTodo: '待办',
  columnInProgress: '进行中',
  columnDone: '已完成',
  newTaskPlaceholder: '新任务标题…（Enter 添加）',
  deleteTask: '删除',
  // terminal panel
  terminalTitle: '终端',
  terminalNewTab: '新终端',
  terminalUnavailableBefore: '终端不可用（',
  terminalUnavailableAfter: '）',
  restartTerminal: '重新启动终端',
  terminalRepairCommand: 'pnpm approve-builds --all && pnpm rebuild node-pty',
  // browse panel
  browseTitle: '浏览',
  browseBlank: '空白页',
  newTab: '新标签',
  newTabTitle: '新建标签',
  sandboxed: '内容运行在不透明源沙箱 iframe 中',
  urlPlaceholder: '搜索或输入网址（http/https）',
  go: '前往',
  openInSystemBrowser: '在系统浏览器打开',
  browseEmptyHint: '输入网址开始浏览。',
  browseSandboxBadge: '沙箱',
  cmdOpenPalette: '工作台：打开命令面板',
  cmdCollapse: '工作台：折叠侧栏',
  cmdExpand: '工作台：展开侧栏',
}

/** The workbench namespace registered with the shared locale runtime. */
export const WORKBENCH_NS = 'workbench'
