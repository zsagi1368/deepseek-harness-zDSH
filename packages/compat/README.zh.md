---
description: "compat 组地图：版本自适应探测 shim，让 fork 特性包针对官方核心守卫自身注册。"
kind: "package-group"
---

# packages/compat（中文）

[English](README.md) | 中文

## 摘要

compat 组持有 fork/上游漂移的版本自适应机制：`dsh-compat` 是唯一允许动态探测官方核心 API 形状的层，每个 zDSH 特性包都通过它守卫自身注册，而不是在部分加载或上游漂移的宿主里抛异常。该 shim 零运行时依赖，并把每次守卫裁决记入进程级审计名册。

## 目录

- [包](#packages)
- [相关文档](#related-documentation)

-----

<a id="packages"></a>
## 包

| 包 | 职责 |
|---|---|
| [`dsh-compat/`](dsh-compat/README.zh.md) | 动态 API 形状探测（`probeSymbol`）、特性守卫（`guardFeature`）与进程级兼容名册 |

-----

<a id="related-documentation"></a>
## 相关文档

- [zDSH 增强服务子系统](../../docs/subsystems/zdsh.zh.md) — 这些包启用的受守卫特性缝与共享的守卫语义。

-----
