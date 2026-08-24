# zDSH

[English](README.md) | 中文

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Stage](https://img.shields.io/badge/Stage-Active_Development-blue)](https://github.com/zsagi1368/deepseek-harness-zDSH)
[![Tests](https://img.shields.io/badge/Tests-1029_passing-brightgreen.svg)](https://github.com/zsagi1368/deepseek-harness-zDSH/actions)

**zDSH**（`deepseek-harness-zDSH`）是一个生产级 agent harness 发行版，具有第一方插件治理体系、多提供商视觉处理管线、跨会话记忆和移动端就绪的 Web 界面。

## 为什么做 zDSH

Agent harness 承诺了自主工作流，但实践中会遇到：第三方插件导致核心崩溃、上下文窗口在冗余内容上浪费 token、会话中断后无法恢复、没有 UI 管理插件健康——更不用说从手机管理了。

zDSH 系统性地解决这些问题：

- **插件不会杀死核心。** 三层沙箱（进程/Worker/内联）+ 加载时验证 + 运行时强制 + 熔断器健康检查，将所有故障隔离在插件边界内。准入默认关闭：未批准的插件注册为 disabled 直到明确批准。
- **上下文保持精简。** omnivision 视觉管线在内容到达 LLM 之前通过多提供商链将图片附件转为文本摘要——保持 KV 缓存完整，消除重复描述的 token 浪费。跨会话记忆使用启发式抽取+关键词重叠注入（零嵌入向量，零额外 LLM 调用）。
- **会话可承受中断。** headless 模式打印结构化 session-id 并支持 `--resume <id>` 用于 CI 和长任务。原子写入+rename 前 fsync 保护会话日志。
- **随处可用。** 移动端响应式 Web UI、HTTP 代理支持受限网络、CJK 感知 token 计价、中文文件名原生命令处理。

## 核心能力

### 插件治理体系
三层沙箱（进程/Worker/内联）、加载-运行-健康守卫（熔断语义）、fail-closed 准入+持久化审批账本、Loader 镜像注册表填充、本地路径 install/uninstall。

### Omnivision 视觉管线
多提供商链（OpenAI / Anthropic / Gemini / OVH / 智谱）自动故障转移、SSRF 防护（DNS 解析+私网段+IPv4 映射 IPv6 校验）、realpath 路径策略含符号链接穿越保护、KV-safe Shadow History。

### 跨会话记忆
从会话事件启发式抽取决策/事实/偏好。日分片 JSON 存储于 `.dsh-zdsh/memory/`。新会话启动按关键词重叠度注入 Top-K。

### Host 治理网关
十个 Typert 直接 Remote 经 API 网关暴露：名册、详情、启停、健康、批准、预设保存/加载/删除。服务端 fail-closed 准入强制+补偿式持久化。

### Web 管理界面
治理标签页与官方 inventory 标签页共存于设置页：名册表格（状态/版本/审批徽章）、启停操作、健康概览条、预设管理。

## 额外改进

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

### 运行

```sh
git clone https://github.com/zsagi1368/deepseek-harness-zDSH.git
cd deepseek-harness-zDSH
pnpm install
pnpm run build
pnpm dsh web
```

Web UI 启动于 `http://127.0.0.1:3080`。前往 **设置 → 插件** 查看 governance 标签页。

### 环境变量

| 变量 | 用途 | 默认值 |
|---|---|---|
| `DSH_BRANCH_HOME` | zDSH 数据根目录 | `~/.dsh-zdsh` |
| `OPENAI_API_KEY` | OpenAI 视觉提供商 | — |
| `ANTHROPIC_API_KEY` | Anthropic 视觉提供商 | — |
| `GEMINI_API_KEY` | Gemini 视觉提供商 | — |

## 架构

```
packages/
├── plugins/plugin-governance/       # 治理核心（spec/registry/guards/sandbox）
├── host/plugin-governance-host/     # Host 面网关服务（10 个 Remote）
├── client/ui-plugin-manager/        # 设置页治理标签页
├── client/workbench/                # IDE Dock（终端/Git/文件浏览器）
├── extensions/omnivision/           # 视觉管线
├── extensions/webstack/             # 整合搜索与抓取内核
├── memory/zdsh-memory/              # 跨会话记忆插件
└── ...                              # 所有平台包
```

## 远程访问

配合 [Tailscale Serve](docs/dsh/remote-access.zh.md) 可从任何设备安全地私网访问。Web UI 响应式适配至 375px 视口。

## 许可证

[MIT](LICENSE)

---

<details>
<summary>关于上游项目 DeepSeek Harness</summary>

DeepSeek Harness（`dsh`）是由 [DeepSeek AI](https://deepseek.com) 开发的开源 agent harness。采用**一切皆插件**架构，由 [Cordis](https://github.com/cordiverse/cordis) 驱动。

目前处于开发者预览阶段，正在快速迭代。详见 [官方仓库](https://github.com/deepseek-ai/deepseek-harness)获取文档与社区资源。

</details>
