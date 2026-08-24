# zDSH — deepseek-harness-zDSH

[English](README.md) | 中文

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/zsagi1368/deepseek-harness-zDSH)
[![Stage](https://img.shields.io/badge/Stage-Active_Development-blue)](https://github.com/zsagi1368/deepseek-harness-zDSH)

**zDSH** 是基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的独立增强发行版——一个由 [DeepSeek AI](https://deepseek.com) 开发的"一切皆插件"开源智能体框架，由 [Cordis](https://github.com/cordiverse/cordis) 驱动。

## 为什么做 zDSH

DeepSeek Harness 是优秀的基座，但生产使用中发现以下缺口，官方迭代节奏无法及时覆盖：

| 问题 | zDSH 方案 |
|---|---|
| 第三方插件可能崩溃核心或泄露宿主数据 | **插件治理体系**：三层沙箱、守卫、fail-closed 准入、持久化审批账本 |
| 跨会话无记忆 | **跨会话记忆插件**：启发式抽取、日分片存储、Top-K 注入（零 LLM = 零额外 token） |
| 图片直发 LLM 破坏 KV 缓存且重复消耗 token | **omnivision 视觉管线**：像素保真提供商链、熔断器、路径策略、SSRF 防护 |
| 企业网络下 web-fetch 不可用 | **HTTP 代理支持**：proxyUrl 配置 + HTTPS_PROXY 回退（undici ProxyAgent） |
| headless 模式无法恢复会话 | **--resume \<session-id\>**：加载持久化会话继续工作 |
| Web UI 无法管理插件健康与启停 | **治理标签页**：名册表格、启停操作、审批、健康概览、预设 |

zDSH 紧跟官方（当前基于 `0.1.1-rc.2`），同时以第一方核心插件形式维护增强功能——设计目标是未来官方合并不会破坏独立功能。

## 核心功能

### 插件治理体系
三层沙箱（进程/Worker/内联）、加载-运行-健康守卫（熔断语义）、fail-closed 准入 + 持久化审批账本、Loader 镜像注册表填充。

### omnivision 视觉管线
多提供商链（OpenAI / Anthropic / Gemini / OVH / 智谱）自动故障转移、SSRF 防护（DNS 解析+私网段校验）、realpath 路径策略、KV-safe Shadow History 保持 DeepSeek 始终接收纯文本。

### 跨会话记忆
启发式抽取决策、事实与偏好。日分片 JSON 存储于 `.dsh-zdsh/memory/`。新会话启动时按关键词重叠度注入 Top-K。零 LLM 调用、零嵌入向量——纯 token 高效方案。

### Host 治理网关
十个 Typert 直接 Remote 经 API 网关暴露：名册、详情、启停、健康、批准、预设保存/加载/删除。服务端强制 fail-closed 准入。支持本地路径 install/uninstall。

### 体验改进
web-fetch HTTP 代理 · headless `--resume <id>` · 会话置顶 · 在资源管理器中显示 · 中文路径安全（koffi COM 对话替代 PowerShell）· 移动端响应式 Web UI · EISDIR 原子写修复 · CJK token 计价修正 · LoadGuard semver 比较

## 快速开始

### 前置条件

- Node.js ≥ 22.19.0（或 ≥ 24.0.0）
- pnpm ≥ 11.x

### 从源码运行

```sh
git clone https://github.com/zsagi1368/deepseek-harness-zDSH.git
cd deepseek-harness-zDSH
pnpm install
pnpm run build
pnpm dsh web
```

Web UI 启动于 `http://127.0.0.1:3080`。前往 **设置 → 插件** 查看 governance 标签页（与官方 inventory 标签页共存）。

### 环境变量

| 变量 | 用途 | 默认值 |
|---|---|---|
| `DSH_BRANCH_HOME` | zDSH 数据根目录（记忆/审批/插件状态） | `~/.dsh-zdsh` |
| `OPENAI_API_KEY` | OpenAI 视觉提供商 | — |
| `ANTHROPIC_API_KEY` | Anthropic 视觉提供商 | — |
| `GEMINI_API_KEY` | Gemini 视觉提供商 | — |

## 架构

zDSH 遵循官方"一切皆插件"架构，全部增强功能实现为第一方 Cordis 插件：

```
packages/
├── plugins/plugin-governance/     # 治理核心（spec/registry/guards/sandbox）
├── host/plugin-governance-host/   # Host 面网关服务（10 个 Typert Remote）
├── client/ui-plugin-manager/      # Web 设置页治理标签页
├── extensions/omnivision/         # 视觉管线（providers/bridge/security）
├── memory/zdsh-memory/            # 跨会话记忆插件
└── ...                            # 所有官方包保持不变
```

## 质量保障

- 红队对抗评审两轮（R1 FAIL → 修复 → R2 PASS-with-notes）
- 构建、类型检查、lint、knip 全绿（2679+ 源文件）
- 317+ 测试全过
- 相对上游净差异：46 新增 / 21 修改 / 0 删除文件

## 同步官方

```sh
git fetch upstream
git merge upstream/master
```

zDSH 与上游维持真实祖先关系——merge 就是正常 Git 操作。

## 社区

- 问题反馈：[Issues](https://github.com/zsagi1368/deepseek-harness-zDSH/issues) 或 [Discussions](https://github.com/zsagi1368/deepseek-harness-zDSH/discussions)
- 上游项目反馈请走[官方 Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions)

## 许可证

[MIT](LICENSE)

---

## 关于上游项目

<details>
<summary>DeepSeek Harness（上游）— 展开查看</summary>

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness。采用**一切皆插件**架构，由 [Cordis](https://github.com/cordiverse/cordis) 驱动。

目前处于开发者预览阶段。详见[官方仓库](https://github.com/deepseek-ai/deepseek-harness)获取文档、架构指南与社区资源。

</details>
