# Agent Note：通过 host 网关服务暴露插件治理能力

Status: implemented

[English](2026-08-23-plugin-governance-gateway.md) | 中文

## 问题

治理体系（spec、注册表、守卫、沙箱、Cordis 适配器、持久化）仅以源码形式存在，没有任何 host 面挂载点：没有组件在真实 profile 中实例化其注册表，名册、生命周期、健康、准入与预设操作对客户端不可达；包本身对 workspace 构建图也不可见（`packages/plugins/*` 目录命名不合规且无构建接线）。

## 决策

新建 host 包 `@deepseek-ai/dsh-host-plugin-governance`（位于 `packages/host/plugin-governance-host/`），注册 `pluginGovernance` Cordis 服务（`PluginGovernanceGateway extends TypertRemoteService`），发布直接 Remote：`list`、`get`、`enable`、`disable`、`health`、`approve`、`presetSave`、`presetLoad`、`presetDelete`。该服务以 `plugin-governance` 条目挂载于 `web-app` bundle patch，紧邻 `plugin-inventory`。

准入默认关闭（fail-closed）：未声明显式权限级别的 manifest 需要操作者裁决，裁决记录在持久化审批账本中；`autoApprove` 的 manifest 可绕过。状态变更先经治理持久化快照、回执返回后内存与磁盘才可能不一致——IO 失败时补偿回滚。预设仅捕获 active/disabled 的操作者决策；运行态状态不入预设。

`install`/`uninstall` 返回 `not-implemented`：接纳第三方代码需要受守卫的下载-准入管线，在该管线出现前明确不做。

## 范围

目录放置遵循仓库源码映射约定：两个新包位于 `packages/<组>/<包名>/src`，与其 `@deepseek-ai/dsh-<名>` 命名一致，并在基础 `paths` 映射中登记 `plugins` 组。`packages/*/*` 下的裸目录会使 tsdown workspace 批处理崩溃，属禁止形态。

网关仅驱动治理注册表。Loader 级安装/卸载流程、消费这些 Remote 的客户端设置界面、OS-keychain 凭证存储均为后续工作。

## Alternatives considered

- **在原治理包内直接增加宿主导向方法** —— 否决：仓库将模型/规范包与宿主/用户侧接缝分目录（`packages/plugins/*` 与 `packages/host/*`），治理包本身不持有 Cordis 面；独立宿主包保持接缝边界，远程面归属宿主。
- **用普通 Cordis RPC 而非 Typert 生成的 Remote** —— 否决：宿主其余面均发布类型化 Remote（plugin-inventory 模式），客户端运行时复用同一双信封解包路径。
- **仅做 Loader 镜像（无原生 install/uninstall）** —— 作为发布约束采纳：镜像覆盖已挂载条目；`install`/`uninstall` 保持 `not-implemented`，直到受守卫的下载-准入管线就绪。

## Consequences

网关新增第七个宿主服务，并为治理持久化增加了可审计的审批/预设状态（与所有已确认变更一样带快照补偿）。`install`/`uninstall` 作为显式缺口保留而非半成品下载器；消费这些 Remote 的设置界面仍属未来工作——远程契约先于其唯一 UI 发布。
