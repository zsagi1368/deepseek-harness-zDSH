# zDSH

[English](README.md) | 中文

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Stage](https://img.shields.io/badge/Stage-Production-blue)](https://github.com/zsagi1368/deepseek-harness-zDSH)
[![Tests](https://img.shields.io/badge/Tests-1029_passing-brightgreen.svg)](https://github.com/zsagi1368/deepseek-harness-zDSH/actions)

**zDSH**（`deepseek-harness-zDSH`）是一个生产级 agent harness 发行版，具有第一方插件治理体系、多提供商视觉处理管线、跨会话记忆和移动端就绪的 Web 界面。开箱即用；所有增强功能均为第一方核心插件，设计为可承受上游升级。

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

## 包含内容

### 插件治理体系
三层沙箱（进程/Worker/内联）· 加载-运行-健康守卫（熔断语义）· fail-closed 准入+持久化审批账本 · Loader 镜像注册表填充 · 本地路径 install/uninstall。

### Omnivision 视觉管线
多提供商链（OpenAI / Anthropic / Gemini / OVH / 智谱）自动故障转移 · SSRF 防护（DNS 解析+私网段+IPv4 映射 IPv6 校验）· realpath 路径策略含符号链接穿越保护 · KV-safe Shadow History。

### 跨会话记忆
从会话事件启发式抽取决策/事实/偏好 · 日分片 JSON 存储于 `.dsh-zdsh/memory/` · 新会话启动按关键词重叠度注入 Top-K · 零 LLM 调用零嵌入向量。

### Host 治理网关
十个 Typert 直接 Remote 经 API 网关暴露：名册/详情/启停/健康/批准/预设保存加载删除 · 服务端 fail-closed 准入强制+补偿式持久化。

### Web 管理界面
治理标签页与官方 inventory 标签页共存于设置页：名册表格（状态/版本/审批徽章）· 启停操作 · 健康概览条 · 预设管理 · 移动端响应式布局。

### 额外改进

| 领域 | 增强 |
|---|---|
| 网络 | web-fetch HTTP 代理支持（proxyUrl 配置 + HTTPS_PROXY 回退） |
| 会话 | headless `--resume <session-id>` 用于 CI 与长任务 |
| 界面 | 会话置顶 · 在资源管理器中显示 · 移动端响应式布局（768px 断点） |
| 文件 | EISDIR 原子写修复+清晰错误信息 |
| LLM | CJK 感知 token 计价（修复中文低估 3–4×） |
| 治理 | LoadGuard semver 比较（消除字典序误判） |
| 安全 | 沙箱子进程环境变量白名单派生 |
| 路径 | Windows 跨盘符逃逸守卫 + ::ffff: IPv6 解包 SSRF 校验 |

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

### 安装到指定目录

设置 `DSH_BRANCH_HOME` 环境变量后再首次启动：

```sh
# Linux / macOS
export DSH_BRANCH_HOME="$HOME/my-custom-zdsh"
# Windows PowerShell
$env:DSH_BRANCH_HOME = "D:\my-custom-zdsh"
```

所有持久化数据（记忆/审批/插件状态/预设）均存储在此目录下。

### 卸载

```sh
rm -rf deepseek-harness-zDSH
rm -rf ~/.dsh-zdsh   # 或自定义 DSH_BRANCH_HOME 路径
```

不安装全局 npm 包；一切从仓库 checkout 运行。

### 环境变量

| 变量 | 用途 | 默认值 |
|---|---|---|
| `DSH_BRANCH_HOME` | 数据根目录 | `~/.dsh-zdsh` |
| `OPENAI_API_KEY` | OpenAI 视觉提供商 | — |
| `ANTHROPIC_API_KEY` | Anthropic 视觉提供商 | — |
| `GEMINI_API_KEY` | Gemini 视觉提供商 | — |

详见详细操作指南。

## 远程访问

配合 Tailscale Serve 可从任何设备安全私网访问。响应式适配至 375px 视口。

## 许可证

[MIT](LICENSE)

---

<details>
<summary>关于上游项目 DeepSeek Harness</summary>

DeepSeek Harness（`dsh`）是由 DeepSeek AI 开发的开源 agent harness。采用一切皆插件架构，由 Cordis 驱动。目前处于开发者预览阶段，详见官方仓库获取文档与社区资源。

</details>
