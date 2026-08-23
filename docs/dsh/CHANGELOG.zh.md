# DSH 变更日志

[English](CHANGELOG.md) | 中文

DSH 分支的变更记录：记载本分支在官方 DeepSeek Harness 基线之上新增的内容，按重组轮次组织，而非流水式的发布日志。

## 分支状态

`our/v2` 是 DSH 治理增强分支，直接重建自官方 `0.1.1-rc.2`（`upstream/master` 位于 `b150a551b8`）。除非下文条目另有说明，官方文件与上游保持字节一致，因此权威差异始终以提交在库内的汇总文件 `docs/dsh/diff-baseline.txt` 为准，由 `scripts/diff-with-official.mjs` 重新生成。

核心能力——通过宿主网关服务暴露插件治理——由[插件治理网关 Agent Note](../../.agents/notes/implemented/feature/2026-08-23-plugin-governance-gateway.zh.md) 承载；产品概览请从根目录 [README](../../README.zh.md) 读起。

## 2026-08 重组轮次

### 基线重建与移植试验

- `18ed5ef202` feat(plugins): import plugin governance sources from our-base-v1 (unwired, T2.1 formalizes)
- `5d7d7fbc49` feat(client): import dsh-client-web-react React glue package from our-base-v1
- `2b7f5116b8` feat(security): import security-fix sources and package supplements from our-base-v1 (T2.7 reviews wiring)
- `368a5c198a` feat(session-stats): port inputTokens accumulation onto official wire projection schema
- `25937720a0` chore: defer incompatible ported sources per compile trial (Plan/artifacts/deferred.list)
- `905ee9c3b6` chore: defer unwired packages per tsdown batch trial (ui-plugin-manager, web-react, schema-form/web supplements)
- `8f6e42096c` chore: defer all unwired bare directories per tsdown workspace trial

### 插件治理与移植修复

- `1888ab80b8` feat(plugins): formalize plugin governance as workspace package
- `f6290d1d33` fix(plugins): unify plugin persistence under ~/.dsh-dsh
- `f718c2c7ea` feat(plugins): CordisAdapter phase 1 - id normalization and official approval bridge
- `c7151697ca` chore(security): adopt upstream equivalents, drop shadowed local files (T2.7)
- `1b527d2635` feat(host): wire plugin governance gateway into the web-app bundle
- `747819b3e9` fix(llm): fail explicitly when a max-tokens cut-off reaches a tool call
- `f91696fa76` fix(atomic-write): fsync temp data before rename, document win32 dir-fsync gap
- `97de227703` fix(session-persistence): drain the batching window on process exit
- `78bc3c1d83` fix(token-meter): price CJK text at script-aware density
- `a7190fcb0f` fix(atomic-write): correct FileHandle type import in fsync regression test
- `46711186ac` feat(client): wire plugin manager tab into Web Plugins settings

### 质量泳道与卫生清理

- `35d6374dab` ci: add plugin governance quality lane for governance stack paths
- `e44324d03e` fix: clear lint violations across governance stack and agent-loop specs
- `24b4eea38e` chore: add upstream diff summary script with committed baseline
- `e8219426e8` chore: scope knip config for test-less ui-plugin-manager and drop unused react-dom

## 历史记录

重组之前的历史不在此复制。更早阶段的任务交接记录保存在仓库外的规划工作区 `Plan/logs/` 下，命名为 `TASK-T0.1.md` 至 `TASK-T3.md`，旁有 `build-r*.log`、`bisect-I*.log` 等试验日志；本轮产物（暂缓清单、T2.7 裁决表等）位于 `Plan/artifacts/` 下。请在对应工作区内按名查阅。
