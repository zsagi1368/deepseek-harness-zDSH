---
description: "Cordis 服务，为所有辅助侧任务模型调用提供统一路由词汇：固定槽位、部署级回退与持久的派发归因。"
kind: "package-reference"
---

# `@deepseek-ai/dsh-model-slots`

[English](README.md) | 中文

## 概述

Cordis 服务（`ctx.modelSlots`），为所有辅助侧任务模型调用提供统一的路由词汇。部署方按内置槽位逐一指明精确的 `provider`/`model` 路由——当前为 `title`（会话标题生成）与 `compaction.summarize`（上下文压缩摘要）——而不是每个消费方各自发明一套配置键与回退方言。

```yaml
- id: model-slots
  name: '@deepseek-ai/dsh-model-slots'
  config:
    slots:
      title:
        provider: deepseek-official
        model: deepseek-v4-flash
    fallback:
      provider: deepseek-official
      model: deepseek-v4-flash
```

`slots.<id>` 固定一个槽位的路由；`fallback` 是部署级默认值，作用于没有自身条目的任何槽位。每个取值都必须是完整且非空的配对，因此只配置一半的槽位不会解析出意外目标。槽位 id 在加载时对照内置词汇校验，像 `tittel:` 这样的笔误会导致启动失败，而不是被静默忽略。

消费方在派发辅助请求之前调用 `resolve(slot, input)`。解析优先级固定：

1. 槽位自身的显式声明（`source: 'slot'`），
2. 部署默认（`source: 'deployment-default'`），
3. 调用方传入的会话主模型路由 `mainRoute`（`source: 'main-route'`），

当没有任何层级能给出路由时，`resolve()` 返回 `null`。每次带 `session` 汇的成功解析都会在调用方派发之前追加持久化的仅日志事件 `slots/dispatch`，携带 `{ slot, provider, model, source }`，使每一次辅助调用都能归因到它实际使用的确切路由——包括所配置的便宜槽位不可用而由主模型承接的情形。

单独发布的 `./invariant` 伴生插件对每条持久的 `slots/dispatch` 记录按封闭的槽位词汇与解析层级进行校验，覆盖注册时已加载的会话以及其后追加的记录。

通过 `register(slot, route)` 进行的程序化注册服务于测试与未来的进程内接线。它不允许覆盖由配置固定的槽位，拒绝重复的存活注册，并返回一个尊重后续重注册的移除用 disposer。

## 目录

- [版本适配（compat 守卫）](#version-adaptation-compat-guard)
- [模型体验](#model-experience)
- [已知限制与遗留工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="version-adaptation-compat-guard"></a>
## 版本适配（compat 守卫）

本功能通过 `@deepseek-ai/dsh-compat` 的 `guardFeature` 对自己的注册做闸门控制（`src/compat.ts` 中的 `guardModelSlots`），在注册前探测它所依赖的对等符号：

- `cordis:Service` —— `@deepseek-ai/cordis` 必须导出可调用的 `Service`。
- `settings:SettingsProvider` —— `@deepseek-ai/dsh-settings` 必须导出 `SettingsProvider` 且其原型提供 `register`（alpha.4 起 `installSettingsSection` 已移除，设置小节经 `ctx.inject(['settings'])` 的 `settings.register()` 注册）。

任一探测失败时，守卫记录一条警告并返回 `false`，本功能随之跳过注册而不是抛错。它永不抛错、永不破坏宿主树：部分加载或上游漂移的宿主只是不带本功能完成启动。

<a id="model-experience"></a>
## Model Experience

间接地，通过在此解析辅助派发路由的消费方体现：本服务只选择侧任务请求使用的 provider/model 对，而请求组装与 provider 适配器拥有模型可见的一切。

#### KV Cache 效应

解析本身不发送请求，也不改变上下文。所选路由决定一次辅助调用落入哪个 provider 缓存：稳定的按槽位声明让连续的辅助请求保持在同一条温热路由上；缺少声明时则跟随会话的主模型路由，共享其缓存行为。修改配置会把后续辅助调用重新指向新路由，并使先前路由持有的前缀复用失效；`slots/dispatch` 记录仅入日志，永不进入模型上下文。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与遗留工作

- **槽位 id 是封闭的内置集合** —— 词汇只随经过评审的消费方增长，部署方暂不能命名自定义槽位；`vision`、`plan` 等槽位推迟到各自的路由集成落地后加入。
- **尚无 settings 镜像层** —— 槽位路由存放在组合层（cordis patch 行）；优先级高于组合层的用户设置界面推迟到 S-45 UI 里程碑，项目级覆盖在安全评审前仍不在范围内。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

本开发备注是维护者的工作上下文：未决的设计问题与方向。它明确非权威——已交付的行为、限制与既定理由见上文各节、包代码及关联 Agent Note。

#### 未来：settings 镜像解析层

槽位路由目前只在组合层。用户设置层（S-45）未来会插在槽位声明与部署默认之间；落地时必须在同一次变更中同时扩展 `resolve()` 的既定优先级与封闭的 `slots/dispatch` 载荷，保持会话可回放。

</details>
