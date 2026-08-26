/** Locale bundles for the plugin configuration section and its plugin cards. */

/** Locale keys these surfaces render. */
export type PluginsSettingsLocaleKey =
  | 'nav' | 'title' | 'intro' | 'tabs' | 'configurableTab' | 'empty'
  | 'installTab' | 'installIntro' | 'installSourceHeading' | 'installSourceBody'
  | 'installRunHeading' | 'installRunHint'
  | 'installSourceCheckout' | 'installSourceGit' | 'installSourceNpm' | 'installSourceTarball'
  | 'installCopy' | 'installCopied' | 'installCopyFailed'
  | 'installVerifyHeading' | 'installVerifyHint'
  | 'installHubIntro' | 'installCenterLink' | 'installRegistryLink' | 'installDocsLink'
  | 'overridden' | 'reset' | 'readOnly' | 'expand' | 'collapse'
  | 'save' | 'saving' | 'discard' | 'unsaved' | 'saveFailed' | 'invalidNumber'
  | 'bashTitle' | 'bashDescription' | 'bashTimeoutMs' | 'bashTimeoutMsHint'
  | 'bashMaxOutputBytes' | 'bashMaxOutputBytesHint'
  | 'agentLoopTitle' | 'agentLoopDescription' | 'agentLoopMaxParallel' | 'agentLoopMaxParallelHint'
  | 'webSearchTitle' | 'webSearchDescription'
  | 'webSearchApiKey' | 'webSearchApiKeyHint' | 'webSearchApiKeySet' | 'webSearchApiKeyUnset'
  | 'webSearchBaseUrl' | 'webSearchBaseUrlHint' | 'webSearchMaxUses' | 'webSearchMaxUsesHint'

/** English copy. */
export const en: Record<PluginsSettingsLocaleKey, string> = {
  nav: 'Plugins',
  title: 'Plugins',
  intro: 'Configure and inspect the plugins installed in this deployment.',
  tabs: 'Plugin views',
  configurableTab: 'Plugin configuration',
  empty: 'This deployment exposes no plugin settings.',
  installTab: 'Install plugins',
  installIntro: 'Plugins ship as packages installed into a profile from your terminal; the steps below are the whole procedure.',
  installSourceHeading: 'Pick a source',
  installSourceBody: 'A local checkout, a Git repository pinned to an exact commit, an npm package, or a packed tarball all install the same way.',
  installRunHeading: 'Run the install command',
  installRunHint: 'Replace <profile> with your profile name, and everything after add with the source you picked.',
  installSourceCheckout: 'Local directory',
  installSourceGit: 'Git repository (pinned commit)',
  installSourceNpm: 'npm package',
  installSourceTarball: 'Tarball',
  installCopy: 'Copy command',
  installCopied: 'Copied to the clipboard.',
  installCopyFailed: 'Copy failed — select the command text and copy it manually.',
  installVerifyHeading: 'Verify, then boot',
  installVerifyHint: 'The config dump lists every bundle layer the profile composes; start the deployment afterwards to activate them.',
  installHubIntro: 'For a visual marketplace with reviewed, reversible installs, install the separate Plugin Center extension; its catalog comes from a reviewed registry:',
  installCenterLink: 'Plugin Center releases',
  installRegistryLink: 'Plugin registry catalog',
  installDocsLink: 'Tutorial: packaging and installing plugins',
  overridden: 'Overridden',
  reset: 'Reset to default',
  readOnly: 'This deployment stores settings read-only.',
  expand: 'Show settings',
  collapse: 'Hide settings',
  save: 'Save',
  saving: 'Saving…',
  discard: 'Discard',
  unsaved: 'Unsaved',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.',
  invalidNumber: 'Enter a number, or leave blank to use the default.',
  bashTitle: 'Shell',
  bashDescription: 'Limits every command the agent runs.',
  bashTimeoutMs: 'Command timeout (ms)',
  bashTimeoutMsHint: 'How long one command may run before it is terminated.',
  bashMaxOutputBytes: 'Output cap per stream (bytes)',
  bashMaxOutputBytesHint: 'Output beyond this spills to a temporary file rather than being lost.',
  agentLoopTitle: 'Agent loop',
  agentLoopDescription: 'How the agent dispatches tool calls.',
  agentLoopMaxParallel: 'Parallel tool calls',
  agentLoopMaxParallelHint: 'Upper bound on parallel-safe calls running at once within one step.',
  webSearchTitle: 'Web search',
  webSearchDescription: 'The DeepSeek search provider.',
  webSearchApiKey: 'API key',
  webSearchApiKeyHint: 'Stored outside the settings file. Leave blank to keep the current key.',
  webSearchApiKeySet: 'A key is configured.',
  webSearchApiKeyUnset: 'No key is configured; search is unavailable until one is.',
  webSearchBaseUrl: 'Endpoint',
  webSearchBaseUrlHint: 'Leave blank to use the provider default.',
  webSearchMaxUses: 'Max searches per request',
  webSearchMaxUsesHint: 'How many times one request may search before it must answer.',
}

/** Simplified Chinese copy. */
export const zh: Record<PluginsSettingsLocaleKey, string> = {
  nav: '插件',
  title: '插件',
  intro: '配置和查看本部署已安装的插件。',
  tabs: '插件视图',
  configurableTab: '插件配置',
  empty: '本部署没有开放任何插件设置。',
  installTab: '安装插件',
  installIntro: '插件以包的形式从终端安装进 profile；下面三步就是全部过程。',
  installSourceHeading: '选择来源',
  installSourceBody: '本地检出、锁定到具体 commit 的 Git 仓库、npm 包或打包好的 tarball，安装方式完全相同。',
  installRunHeading: '运行安装命令',
  installRunHint: '把 <profile> 替换成你的 profile 名，add 后面的部分换成你选择的来源。',
  installSourceCheckout: '本地目录',
  installSourceGit: 'Git 仓库（锁定 commit）',
  installSourceNpm: 'npm 包',
  installSourceTarball: 'tarball 包',
  installCopy: '复制命令',
  installCopied: '已复制到剪贴板。',
  installCopyFailed: '复制失败——请手动选中命令文本复制。',
  installVerifyHeading: '验证并启动',
  installVerifyHint: '配置 dump 会列出该 profile 组合的每个插件层；之后正常启动部署即可生效。',
  installHubIntro: '想要图形化的市场浏览与可回滚的受控安装，可以另装独立的 Plugin Center 扩展；其目录来自经过审核的注册表：',
  installCenterLink: 'Plugin Center 发布页',
  installRegistryLink: '插件注册表目录',
  installDocsLink: '教程：打包与安装插件',
  overridden: '已覆盖',
  reset: '恢复默认',
  readOnly: '本部署的设置为只读。',
  expand: '展开设置',
  collapse: '收起设置',
  save: '保存',
  saving: '保存中…',
  discard: '放弃修改',
  unsaved: '未保存',
  saveFailed: '本部署没有接受这些值，已保留供你修改。',
  invalidNumber: '请填数字；留空表示使用默认值。',
  bashTitle: '终端',
  bashDescription: '限制 agent 运行的每一条命令。',
  bashTimeoutMs: '命令超时（毫秒）',
  bashTimeoutMsHint: '单条命令允许运行多久，超时即终止。',
  bashMaxOutputBytes: '单流输出上限（字节）',
  bashMaxOutputBytesHint: '超出部分会转存到临时文件，而不是被丢弃。',
  agentLoopTitle: 'Agent 循环',
  agentLoopDescription: 'Agent 如何派发工具调用。',
  agentLoopMaxParallel: '并行工具调用数',
  agentLoopMaxParallelHint: '同一步内最多同时运行多少个可并行的调用。',
  webSearchTitle: '网页搜索',
  webSearchDescription: 'DeepSeek 搜索提供方。',
  webSearchApiKey: 'API Key',
  webSearchApiKeyHint: '不写入设置文件。留空表示保持当前密钥。',
  webSearchApiKeySet: '已配置密钥。',
  webSearchApiKeyUnset: '未配置密钥；配置之前搜索不可用。',
  webSearchBaseUrl: '接口地址',
  webSearchBaseUrlHint: '留空则使用提供方默认地址。',
  webSearchMaxUses: '单次请求最多搜索次数',
  webSearchMaxUsesHint: '一次请求在必须作答前最多可以搜索多少次。',
}
