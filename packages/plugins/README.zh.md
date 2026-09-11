---
description: "plugins 组地图：第三方扩展流入的两个宿主面——治理内核（LoadGuard/RunGuard/HealthGuard）与项目级插件根。"
kind: "package-group"
---

# packages/plugins（中文）

[English](README.md) | 中文

## 摘要

plugins 组持有第三方扩展流入的两个宿主面：治理内核（注册表镜像之上的 `LoadGuard`/`RunGuard`/`HealthGuard`）与项目级插件根 —— 后者从 `<projectRoot>/.dsh/plugins` 发现插件，对沙箱做宿主钳制，经耐久信任账本守卫，并在启动后作为隔离的 Cordis 层挂载。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)

-----

<a id="packages"></a>
## 包

| 包 | 职责 | ctx 键 |
|---|---|---|
| [`plugin-governance/`](plugin-governance/README.zh.md) | 治理规范与内核：spec、registry、guards、sandbox、Cordis 适配器与持久化 | `ctx.pluginGovernance`（宿主 Remote 经 `plugin-governance-host`） |
| [`plugin-project-root/`](plugin-project-root/README.zh.md) | 项目级插件发现、宿主钳制、守卫、信任账本与启动后层挂载 | `ctx.projectPluginLayer` |

-----

<a id="related-documentation"></a>
## 相关文档

- [zDSH 增强服务子系统](../../docs/subsystems/zdsh.zh.md) — 这些包提供的插件治理网关与项目插件层，及其守卫与沙箱语义。

-----
