# zDSH

[English](README.md) | 中文

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Stage](https://img.shields.io/badge/Stage-Active_Development-blue)](https://github.com/zsagi1368/deepseek-harness-zDSH)
[![Tests](https://img.shields.io/badge/Tests-1029_passing-brightgreen.svg)](https://github.com/zsagi1368/deepseek-harness-zDSH/actions)

**zDSH**（`deepseek-harness-zDSH`）是一个生产级 agent harness 发行版，具有第一方插件治理体系、多提供商视觉处理管线、跨会话记忆和移动端就绪的 Web 界面。

## 为什么做 zDSH

DeepSeek Harness 提供了优秀的插件优先基座——但生产使用中发现以下缺口，官方迭代节奏无法及时覆盖：

| 问题 | 影响 | zDSH 方案 |
|---|---|---|
| 第三方插件可能崩溃核心或通过不受限的文件访问和环境继承泄露宿主数据 | 数据丢失、安全漏洞 | **插件治理体系**：三层沙箱、加载时验证、运行时强制、熔断器健康检查、fail-closed 准入 |
| 跨会话无持久知识——每次对话从零开始 | 重复解释、决策丢失 | **跨会话记忆**：启发式抽取决策/事实/偏好，日分片存储，会话启动 Top-K 注入 |
| 图片直发 LLM 破坏 KV 缓存且重复描述消耗 token | 响应慢、成本高 | **omnivision 视觉管线**：像素保真提供商链在 LLM 接收前将图片转为文本 |
| `web-fetch` 在企业代理后不可用 | 工具完全不可用 | 通过 undici ProxyAgent + 环境变量回退实现 HTTP 代理支持 |
| headless 模式无法恢复 CI 中的会话 | 手动重建 prompt | `--resume <session-id>` 加载持久化会话历史 |
| 中文文件路径被基于 PowerShell 的目录选择器静默损坏 | 选择错误工作区 | koffi COM 对话框原生 UTF-16 路径处理 |

zDSH 紧跟上游（当前基于 `0.1.1-rc.2`），同时以第一方核心插件形式维护增强功能——设计目标是未来官方合并不会破坏独立功能。

## 核心功能

### 插件治理体系
三层沙箱（进程/Worker/内联）、加载-运行-健康守卫（熔断语义）、fail-closed 准入+持久化审批账本、Loader 镜像注册表填充、本地路径 install/uninstall。

### Omnivision 视觉管线
多提供商链（OpenAI / Anthropic / Gemini / OVH / 智谱）自动故障转移、SSRF 防护（DNS 解析+私网段+IPv4 映射 IPv6 校验）、realpath 路径策略含符号链接穿越保护、KV-safe Shadow History。

### 跨会话记忆
从会话事件启发式抽取决策/事实/偏好。日分片 JSON 存储于 `.dsh-zdsh/memory/`。新会话启动按关键词重叠度注入 Top-K。

### Web 管理界面
治理标签页与官方 inventory 标签页共存于设置页：名册表格（状态/版本/审批徽章）、启停操作、健康概览条、预设管理。

### 额外改进
完整列表见下方[功能矩阵](#additional-improvements-over-stock-deepseek-harness)。

## 快速开始

### 前置条件

- Node.js ≥ 22.19.0（或 ≥ 24.0.0）
- pnpm ≥ 11.x
- Git ≥ 2.40

### 安装并运行

```sh
git clone https://github.com/zsagi1368/deepseek-harness-zDSH.git
cd deepseek-harness-zDSH
pnpm install
pnpm run build
pnpm dsh web
```

Web UI 启动于 `http://127.0.0.1:3080`。前往 **设置 → 插件** 查看 governance 标签页。

> **Windows 用户**：请启用开发者模式（设置 → 隐私和安全性 → 开发者选项）以获得部分包所需的符号链接支持。

### 环境变量

| 变量 | 用途 | 默认值 |
|---|---|---|
| `DSH_BRANCH_HOME` | zDSH 数据根目录 | `~/.dsh-zdsh` |
| `OPENAI_API_KEY` | OpenAI API 访问 | — |
| `ANTHROPIC_API_KEY` | Anthropic API 访问 | — |
| `GEMINI_API_KEY` | Gemini API 访问 | — |

### 安装到指定目录

zDSH 所有数据存储在 `DSH_BRANCH_HOME` 下。要安装到自定义位置：

```sh
export DSH_BRANCH_HOME="/path/to/your/data/dir"
pnpm dsh web
```

所有治理数据、记忆分片、审批账本和插件状态均存储在该目录下——与官方 `~/.dsh/` 目录完全隔离。

### 卸载

```sh
rm -rf ~/.dsh-zdsh        # 删除 zDSH 数据
rm -rf deepseek-harness-zDSH   # 删除仓库
```

不安装任何全局包；一切从项目目录运行。

## 架构

```
packages/
├── plugins/plugin-governance/       # 治理核心（spec/registry/guards/sandbox）
├── host/plugin-governance-host/     # Host 面网关服务（10 个 Remote）
├── client/ui-plugin-manager/        # 设置页治理标签页
├── client/workbench/                # IDE Dock（终端/Git/文件浏览器）
├── extensions/omnivision/           # 视觉管线
├── extensions/webstack/             # 整合搜索与抓取内核
├── extensions/file-hub/             # 文件管理
├── extensions/autopilot/            # 自动化编排
├── memory/zdsh-memory/              # 跨会话记忆插件
└── ...                              # 所有官方平台包保持不变
```

## 相对原版额外改进

| 领域 | 增强 |
|---|---|
| 网络 | web-fetch HTTP 代理支持（proxyUrl 配置 + HTTPS_PROXY 回退） |
| 会话 | headless `--resume <session-id>` 用于 CI 与长任务 |
| 界面 | 会话置顶 · 在资源管理器中显示 · 移动端响应式布局（768px 断点） |
| 文件 | EISDIR 原子写修复+清晰错误信息 · koffi COM 对话替代 PowerShell 实现中文路径安全 |
| LLM | CJK 感知 token 计价（修复中文低估 3–4×）· LoadGuard semver 比较 |
| 安全 | 沙箱子进程环境变量白名单派生 · ::ffff: IPv6 解包 SSRF 校验 · Windows 跨盘符逃逸守卫 |

## 上游同步

```sh
git fetch upstream
git merge upstream/master
```

zDSH 与上游维持真实祖先关系——merge 就是正常 Git 操作。

## 许可证

[MIT](LICENSE)
