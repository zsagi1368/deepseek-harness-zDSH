---
description: "zdsh 组地图：分叉自研底座——版本自适应兼容 shim、宿主侧治理内核及其宿主服务面、项目级插件根，以及钉住全部出厂预装插件的私有装配束。"
kind: "package-group"
---

# packages/zdsh（中文）

[English](README.md) | 中文

## 摘要

zdsh 组是 zDSH 自研底座的命名空间：本分叉在官方核心之上新增的每一个件都居于此（守恒指标：自研面 100% 位于 `packages/zdsh/*`）。组内统一四个面。版本自适应探测 shim（`dsh-compat`）是唯一允许动态探测官方核心 API 形状的层；每个 zDSH 功能件都经它对自身注册做门控，而非在部分装载或上游漂移的启动期抛错，每个裁决都记入进程级审计花名册。治理内核（`plugin-governance`：注册表镜像之上的 `LoadGuard`/`RunGuard`/`HealthGuard`）及其宿主服务面（`plugin-governance-host`：网关、远端词汇表与出厂工件的种子预装器）持有第三方扩展流入的宿主面。项目级插件根（`plugin-project-root`）从 `<projectRoot>/.dsh/plugins` 发现插件，对沙箱做宿主钳制，经耐久信任账本守卫，并在启动后作为隔离的 Cordis 层挂载。私有出厂装配束（`factory-bundle`）以 git URL + 完整 commit 钉住每个出厂预装插件，一次 `pnpm install` 即把全部工件落进治理预装执行器的工作区闭包。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`dsh-compat/`](dsh-compat/README.zh.md) | 动态 API 形状探测（`probeSymbol`）、功能守卫（`guardFeature`）与进程级兼容花名册；零运行时依赖 | —（进程级花名册） |
| [`plugin-governance/`](plugin-governance/README.zh.md) | 治理规范与内核：spec、registry、guards、sandbox、Cordis 适配器与持久化 | `ctx.pluginGovernance`（宿主 Remote 经 `plugin-governance-host`） |
| [`plugin-governance-host/`](plugin-governance-host/README.zh.md) | 宿主服务面：治理网关（`PluginGovernanceGateway`）、远端词汇表（`/types` `/typert` `/remote`）与出厂种子预装器 | —（宿主服务） |
| [`plugin-project-root/`](plugin-project-root/README.zh.md) | 项目级插件发现、宿主钳制、守卫、信任账本与启动后层挂载 | `ctx.projectPluginLayer` |
| [`factory-bundle/`](factory-bundle/README.zh.md) | 私有清单：七个出厂预装插件的 git URL + 完整 commit pin（`@deepseek-ai/zdsh-factory-bundle`）；不发布、无可执行源码 | —（依赖清单） |

-----

<a id="related-documentation"></a>
## 相关文档

- [zDSH 增强服务子系统](../../docs/subsystems/zdsh.zh.md) — 这些包提供的插件治理网关、项目插件层与出厂预装谱，及其守卫与沙箱语义。

-----
