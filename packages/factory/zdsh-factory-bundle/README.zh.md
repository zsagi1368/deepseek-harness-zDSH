---
description: "私有出厂工件包：为每一个 zDSH 出厂预装插件钉住 git URL + commit，令一次 pnpm install 即把各工件落入 workspace 闭包，供治理预装执行器就地纳管。"
kind: "package-library"
---

# @deepseek-ai/zdsh-factory-bundle

[English](README.md) | 中文

## 概述

以 git URL + 完整 commit pin 声明每一个 zDSH 首启出厂预装的插件。治理 `SeedPreinstaller` 经既有 `install({ source: 'local:<目录>' })` 通道就地纳管各钉定工件；本包从不搬运、复制或删除工件。唯一消费者是出厂预装通道，最小入口是一行 `dependencies`。批次 1.3 以单件 `dsh-webstack-verticals` 试点。

## 使用本包

在 `dependencies` 下加一行 `<包名>: git+https://…#<40-hex commit>`，再跑 `pnpm install`，工件即落入本包的 `node_modules` 闭包。把 `zdsh-factory/seed.json` 对应条目的 `source` 指向解析到的目录即可。试点探针在 `tests/gate-p.spec.ts`。

## Model Experience

无——本包为私有依赖清单，不注册任何面向模型的内容。

#### KV Cache 影响

此处无任何内容进入请求前缀，provider 缓存复用不受影响。

## 已知限制与延后事项

- 未随附任何运行时 invariant companion；本包为私有依赖清单，无可执行源码、亦无需断言不变量的可变运行态。
- git 依赖会克隆仓库根，故 `dsh-webstack-verticals` 实际解析到 WebStack monorepo，seed 的 `local:` 源指向其 `packages/verticals` 子目录。
- 当前仅钉批次 1.3 试点单件；其余接盘插件在后续批次加入。

### 开发注记

在此新增依赖属供应链变更：必须携带 40-hex commit pin（禁用分支或浮动区间），且每条新条目须配 `zdsh-factory/seed.json` 对应行与一条 Gate-P 探针。
