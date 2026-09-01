# zDSH（尚未完成，即将上线）

[English](README.md) | 中文

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[![Stage](https://img.shields.io/badge/Stage-Production-blue)](https://github.com/zsagi1368/deepseek-harness-zDSH)

[![Tests](https://img.shields.io/badge/Tests-passing-brightgreen.svg)](https://github.com/zsagi1368/deepseek-harness-zDSH/actions)

**zDSH**（`deepseek-harness-zDSH`）是一个生产级 agent harness 发行版，具有第一方插件治理体系、多提供商视觉处理管线、跨会话记忆和移动端就绪的 Web 界面。开箱即用；所有增强功能均为第一方核心插件，设计为可承受上游升级——另外，版本感知适配层（`@deepseek-ai/dsh-compat`）守卫每个功能的注册，对照官方核心 API 形状自动检测，升级自动适配，检测到冲突自动禁用对应功能，绝不会拖垮核心。

## 为什么做 zDSH

Agent harness 承诺了自主工作流，但实践中会遇到：第三方插件导致核心崩溃、上下文窗口在冗余内容上浪费 token、会话中断后无法恢复、没有 UI 管理插件健康——更不用说从手机管理了。

zDSH 系统性地解决这些问题：

| 没有 zDSH | 有 zDSH |
|---|---|
| 第三方插件 bug 导致整个 agent 崩溃 | 三层沙箱将所有故障隔离在插件边界内 |
| 跨会话无记忆——不断重复自己 | 跨会话记忆：启发式抽取+Top-K 注入，零额外 LLM token |
| 图片附件浪费 KV 缓存重复描述 | Omnivision 管线：像素保真提供商链，纯文本输出保持缓存完整 |
| 插件健康不可见直到出问题 | 实时治理标签页：名册、准入徽章、启停操作、预设 |
| 企业网络下 web-fetch 不可用 | HTTP 代理支持（undici ProxyAgent + 环境变量回退） |
| headless 运行是一次性的 | 结构化 session-id 输出 + `--resume <id>` 用于 CI |
| 官方升级悄悄破坏 fork 功能 | 版本感知适配层：自动适配、冲突自动禁用，绝不拖垮核心 |

## 包含内容

### 版本感知适配层

`@deepseek-ai/dsh-compat` 守卫每个 zDSH 功能的注册，对照官方核心的真实 API 形状：动态符号探测（`probeSymbol`/`memberOf`/`versionOf`）+ 功能守卫（`guardFeature`）并附进程级审计名册。七大主打功能——插件治理、项目插件根、模型槽位体系、ACP、引导加固、工作台二进制收口、UI 槽位——全部带 compat 守卫：官方核心升级时自动适配，检测到冲突自动不启用，绝不拖垮核心。

### 插件治理体系

三层沙箱（进程 / Worker / 内联）· 加载-运行-健康守卫（熔断语义）· fail-closed 准入 + 持久化审批账本 · Loader 镜像注册表填充 · 经准入管线的本地路径与 npm 注册表 install/uninstall。

### 项目插件根

`.dsh/plugins/` 项目级插件根：项目根发现 · 钳制强制 · 挂载隔离 · provenance 追踪 · 信任 ledger · 子进程运行时 · 会话作用域激活。项目插件与第一方插件一样接受治理、隔离与版本管理。

### Omnivision 视觉管线

多提供商链（OpenAI / Anthropic / Gemini / OVH / 智谱）自动故障转移 · SSRF 防护（DNS 解析 + 私网段 + IPv4 映射 IPv6 校验）· realpath 路径策略含符号链接穿越保护 · KV-safe Shadow History。

### 跨会话记忆

从会话事件启发式抽取决策 / 事实 / 偏好 · 日分片 JSON 存储于 `.dsh-zdsh/memory/` · 新会话启动按关键词重叠度注入 Top-K · 零 LLM 调用零嵌入向量。

### 模型槽位体系

辅助模型调用的统一注册表（`ctx.modelSlots`）：四个内置槽位（`title` / `compaction.summarize` / `vision` / `plan`）共享一个封闭词汇表。部署配置为每个槽位钉住精确的 provider/model，带 fallback 默认值，并以会话主模型路由作为最终档位。每次成功解析都会追加持久化的 `slots/dispatch` 审计记录。UI 设置命名空间（`llm-model-slots`）允许用户在不改动部署文件的前提下编辑槽位策略。

### Host 治理网关

Typert 直接 Remote 经 API 网关暴露：名册 / 详情 / 启停 / 健康 / 批准 / 预设保存加载删除 · 服务端 fail-closed 准入强制 + 补偿式持久化。

### Web 管理界面

治理标签页与官方 inventory 标签页共存于设置页：名册表格（状态 / 版本 / 审批徽章）· 启停操作 · 健康概览条 · 预设管理 · 移动端响应式布局。

### ACP 自动化入口

`dsh acp`——基于 JSON-RPC stdio 的稳定自动化专用 Agent Client Protocol 服务端 · 会话恢复（session resume）· 全档位权限选项（一次性允许/拒绝），面向 headless 与 CI 工作流。

### 额外改进

| 领域 | 增强 |
|---|---|
| 网络 | web-fetch HTTP 代理支持（`proxyUrl` 配置 + `HTTPS_PROXY` 回退） |
| 会话 | headless `--resume <session-id>` 用于 CI 与长任务 |
| 界面 | 会话置顶 · 在资源管理器中显示 · 移动端响应式布局（768px 断点） |
| 文件 | EISDIR 原子写修复 + 清晰错误信息 |
| LLM | CJK 感知 token 计价（修复中文低估 3–4×） |
| LLM | D-005：max-tokens 截断触及工具调用时显式失败 |
| 引导 | D-006：Windows 引导 realpath + 系统路径 env 黑名单 |
| 工作台 | 裸名进程 spawn fail-closed（不做降级 spawn） |
| 治理 | 沙箱 realpath 硬化（符号链接/联接逃逸防护） |
| 治理 | LoadGuard semver 比较（消除字典序误判） |
| 安全 | 沙箱子进程环境变量白名单派生 |
| 路径 | Windows 跨盘符逃逸守卫 + ::ffff: IPv6 解包 SSRF 校验 |

## Run from source

想在发布前体验 `our/v2` 的最新改动，可直接克隆并本地构建：前置条件与完整命令见下文 Getting started 一节。

## Getting started

### Prerequisites

- Node.js ≥ 22.19.0（或 ≥ 24.0.0）
- pnpm ≥ 11.x
- Git ≥ 2.40

### Install and run

```sh
git clone https://github.com/zsagi1368/deepseek-harness-zDSH.git
cd deepseek-harness-zDSH
pnpm install
pnpm run build
pnpm dsh web
```

Web UI 启动于 `http://127.0.0.1:3080`。前往 **Settings → Plugins** 查看治理标签页。

<a id="installation"></a>

## 安装

如需自包含安装——所有数据都收拢在仓库目录内——可在仓库检出目录中运行对应平台的安装脚本：

```sh
# Windows (PowerShell 5.1+)
.\install.cmd
# macOS / Linux / WSL
./scripts/install.sh
```

安装脚本会检查前置条件（`Node.js ^22.19.0 || >=24` 与 `pnpm`），依次执行 `pnpm install --frozen-lockfile` 与 `pnpm run build`，并生成：

- `data/` —— 数据主目录（`DSH_HOME`）。官方模块数据与 zDSH 治理数据（插件注册表、审批账本，以及 `data/zdsh/` 下的已装插件）都保存在这里。
- `env.ps1` / `env.sh` —— 环境加载脚本，定义 `DSH_HOME`、`DSH_AGENTS_HOME`，以及指向已构建 CLI 的 `dsh` 命令。

使用前先加载环境：

```sh
# PowerShell
. .\env.ps1
# bash
source ./env.sh
```

之后照常运行 `dsh web` 即可。

<a id="uninstall"></a>

## 卸载

在仓库检出目录中运行对应平台的卸载脚本：

```sh
# Windows (PowerShell 5.1+)
.\uninstall.cmd
# macOS / Linux / WSL
./scripts/uninstall.sh
```

默认模式会移除检出版内所有被 gitignore 忽略的产物（`node_modules`、构建输出、`data/`、`env.ps1` / `env.sh`），恢复纯净检出版状态。附加选项：`--purge`（PowerShell 为 `-Purge`）会在清理之后连整个仓库目录一并删除；`--clean-legacy`（PowerShell 为 `-CleanLegacy`）会同时删除 zDSH 旧版主目录（`~/.dsh-zdsh`、`~/.zdsh-workbench`、`~/.zdsh-plugin-center`）。`~/.dsh` 属于官方版本数据，仅在显式确认后才会处理；本脚本从不删除 `~/.agents`，仅在存在时报告。

### 自定义数据目录

安装布局默认把全部数据收拢在仓库目录的 `data/` 内：把整个仓库目录放在任意位置、整体移动或删除即可，无外溢文件。高级用户可用环境变量重定向：`DSH_HOME` 指定官方与 zDSH 数据的共同根（zDSH 数据自动落于 `<DSH_HOME>/zdsh`）；旧变量 `DSH_BRANCH_HOME` 仍受支持且优先级最高（显式覆盖）。

### Environment variables

| 变量 | 用途 | 默认值 |
|---|---|---|
| `DSH_HOME` | 数据主目录（官方模块 + zDSH 治理数据，后者自动落于 `<DSH_HOME>/zdsh`） | `~/.dsh` |
| `DSH_BRANCH_HOME` | 兼容覆盖：zDSH 治理数据根（优先级高于 `DSH_HOME` 派生） | `~/.dsh-zdsh` |
| `OPENAI_API_KEY` | OpenAI 视觉提供商 | — |
| `ANTHROPIC_API_KEY` | Anthropic 视觉提供商 | — |
| `GEMINI_API_KEY` | Gemini 视觉提供商 | — |

高级配置与发布历史见 [远程访问指南](docs/dsh/remote-access.zh.md) 与 [变更记录](docs/dsh/CHANGELOG.zh.md)。

## Architecture

```
packages/
├── compat/dsh-compat/              # 版本感知适配框架（探测 + 守卫 + 名册）
├── plugins/plugin-governance/       # 治理核心（spec、注册表、守卫、沙箱）
├── plugins/plugin-project-root/     # 项目插件根（.dsh/plugins）层
├── llm/model-slots/                 # 统一模型槽位注册表（title / compaction.summarize / vision / plan）
├── acp/acp/                         # JSON-RPC stdio 自动化专用 ACP 服务端
├── host/plugin-governance-host/     # Host 平面网关服务（10 个 Remote）
├── client/ui-plugin-manager/        # Web 设置治理标签页
├── client/ui-settings-models/       # 模型槽位 UI 配置
├── client/workbench/                # IDE 停靠栏（终端、git、文件浏览器）
├── extensions/omnivision/           # 视觉管线（提供商、桥接、安全）
├── extensions/webstack/             # 集成搜索与抓取内核
├── extensions/file-hub/             # 文件管理
├── extensions/autopilot/            # 自动化编排
├── extensions/plugin-center/        # 插件中心 UI
├── memory/zdsh-memory/              # 跨会话记忆插件
└── ...                              # 其余平台包与上游一致，未改动
```

## Remote access

配合 [Tailscale Serve](docs/dsh/remote-access.zh.md) 开箱即用，可从任何设备安全私网访问。响应式适配至 375px 视口。

## Upstream sync

```sh
git remote add upstream https://github.com/deepseek-ai/deepseek-harness.git
git fetch upstream
git merge upstream/master
```

zDSH 与上游保持真实祖先关系——合并就是普通的 Git 操作。

## Community

- 报告问题或提交建议：[GitHub Issues](https://github.com/zsagi1368/deepseek-harness-zDSH/issues)

## License

[MIT](LICENSE)

---

<details>
<summary>关于 DeepSeek Harness（上游项目）</summary>

<br>

# DeepSeek Harness

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness。

采用一切皆插件架构，由 [Cordis](https://github.com/cordiverse/cordis) 驱动，其设计思想见论文 [_A Programming Paradigm for Spatiotemporal Composability_](https://github.com/cordiverse/paper)。

## Developer preview

DeepSeek Harness 当前处于开发者预览阶段，迭代迅速。**将存在破坏性兼容变更。**

## Run

```sh
npx @deepseek-ai/dsh web
```

## Community and support

- 通过 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 提交反馈。
- 加入 [Discord 社区](https://discord.gg/Ycq5dCaS4)。
- 贡献规范见上游仓库的 CONTRIBUTING.md。

## Development

从[开发指南](docs/development.zh.md)与[架构文档](docs/architecture.zh.md)开始。

代理开发请遵循 [AGENTS.md](AGENTS.md)。

## License

[MIT](LICENSE)

第三方依赖披露见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

</details>
