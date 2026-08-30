# dsh-plugin-governance（中文）

[English](README.md) | 中文

治理规范与内核：spec/registry/guards/sandbox/Cordis 适配器/持久化。

## Model Experience

### Guard kernel

#### What the model sees

`LoadGuard#preLoad`、`RunGuard#execute` 与 `HealthGuard` 构成守卫语义：加载拒面、超时切断、连续失败升级禁用。

##### Guard contract

```markdown
LoadGuard.preLoad(plugin, kernelVersion): LoadResult { allowed, failures }
```

#### Token effect

内核本身不接触模型上下文；token 影响完全由消费方决定。

#### KV Cache effect

无：持久化走 registry.json/approvals.json 快照，无 KV 参与。

## 版本适配（compat 守卫）

沙箱通过 `@deepseek-ai/dsh-compat` 的 `guardFeature` 对自己的注册做闸门控制（`src/compat.ts` 中的 `guardGovernance`），在挂载前探测它所依赖的对等符号：

- `cordis:Service` —— `@deepseek-ai/cordis` 必须导出可调用的 `Service`。
- `governance:LoadGuard` —— `@deepseek-ai/dsh-plugin-governance` 必须导出可调用的 `LoadGuard`。

任一探测失败时，守卫记录一条警告并返回 `false`，沙箱随之跳过注册而不是抛错。它永不抛错、永不破坏宿主树：部分加载或上游漂移的宿主只是不带沙箱完成启动。

## Known Limitations and Deferred Work

- LoadGuard 对弱畸形清单（空格 id、空能力表）采取容忍策略，硬性拦截面为版本兼容与沙箱形状校验。
- 运行时资源限制依赖调用方执行守卫，不强制挂载。
