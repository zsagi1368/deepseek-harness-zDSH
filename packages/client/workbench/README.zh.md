# zdsh-workbench（中文）

zDSH 工作台 —— 为 DSH（deepseek-harness）打造的 IDE 级停靠工作区插件：文件 / 编辑器 / 终端 / Git / 任务 / 浏览一屏直达，并向所有插件开放面板与命令注册表服务。

**净室独立开发**：功能思想参考了社区的侧边栏/全家桶实践，但全部代码、API 形状与资源均为原创，未复制任何社区代码。

## 功能

- **🗂 文件工作台**：懒加载目录树（软链语义、失效链接标红）、面包屑导航、名称搜索（跳过 node_modules/.git）、原子写入、图片/PDF 内嵌预览、沙箱 iframe 的 HTML 预览、文本编辑（Ctrl/Cmd+S 保存）
- **💻 终端**：node-pty + xterm.js 真 shell，最多 3 个/会话；断线重连回放滚动缓冲；Windows 自动探测 pwsh → PowerShell
- **🌿 Git 中心**：分支胶囊（ahead/behind）、暂存/取消暂存、内联彩色 diff、Ctrl/Cmd+Enter 提交、历史列表；fetch/pull/push 一律先预览再确认
- **✅ 任务中心**：三栏看板，宿主权威账本 + 单调 revision + SSE 推送信号，损坏文件自动隔离
- **🌐 浏览**：多标签沙箱浏览器（不透明源 iframe），拒绝脚本协议与内网地址，一键转系统浏览器
- **⌘ 命令面板**：Ctrl/Cmd+Shift+P 模糊搜索命令；所有内置功能与第三方扩展走同一注册表 API
- **📱 移动端**：<768px 自动切换全宽抽屉

## 安全模型

- 所有路由共用与 DSH `/api` 同源的 Host 信任围栏（DNS 重绑定防御）
- 每次文件操作实时校验工作区包含性：绝对路径强制、win32 跨盘陷阱防护、symlink realpath 逃逸拒绝
- git 仅以 argv 数组调用、不写任何身份配置；网络操作必须显式确认
- 部署可选 `allowedRoots` 工作区钳制：非空时请求声明的 cwd 必须落在白名单目录内（端口暴露到局域网时建议开启）

## 安装（源码方式）

```sh
git clone https://github.com/zsagi1368/zdsh-workbench.git
cd zdsh-workbench && pnpm install && pnpm approve-builds --all && pnpm build
# 在 ~/.dsh/profiles/web/package.json 的 dependencies 加：
#   "zdsh-workbench": "file:<本仓库绝对路径>"
# 然后在 profile 目录 pnpm install，重启 dsh web 并硬刷新浏览器
```

官方 bundle patch 已内置于包中，安装器会自动追加挂载行。

## 开发

```sh
pnpm typecheck && pnpm build && pnpm test   # 三道门禁
```

里程碑历史见 `CHANGELOG.md`；完整设计见 `docs/PLAN.md`。

MIT License
