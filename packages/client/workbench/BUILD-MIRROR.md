# BUILD-MIRROR：workbench in-tree 构建镜像契约

> 状态：规范性文档（T3b-B 实施卡落盘，2026-09-27）。裁决链：D3 用户批准「双源本次收敛」→ T3b 可行性设计实证装件化存在真源侧三硬缺口且落 O-3 独立裁决域 → 主线裁决采纳 **B 案**：本目录降级为构建镜像（真源 = 权威源），装件化登记为条件触发后置卡；D3「删 in-tree」半句暂缓、呈报用户。
> 依据文档（zDSH-docs 仓）：`Plan/campaigns/2026-09-27-upgrade-process-v2/T3b-design.md`（重点 §6 B 案与 §5 O-3 域结论）、`T3a-backfill-ledger.md`（真源收敛台账）。

## 1. 定位：本目录 = 构建镜像，权威源 = 真源仓

- 本目录 `packages/client/workbench/` 是 **vendored 构建镜像**，不是 Workbench 代码的权威真源。
- **权威源（真源仓）**：`zsagi1368/zdsh-workbench`（https://github.com/zsagi1368/zdsh-workbench）。
- **当前镜像锚**：真源 `main` @ `193af62`（完整 hash `193af626a579c565aff6fe939acc25d1c4a3a302`；已推云并经 `git ls-remote` 亲验，T3a 收敛终点）。
- 镜像的存在理由：本目录是主仓构建图中当前唯一具备完整 client 装件面（`dsh.client` 声明 + factory 形 client bundle）的工件，保留「宿主 bundle/boot 接回」路径；运行时零消费（零跨包 import、零 bundle 挂载行——zdsh-latest 现行谱系从未挂载 workbench，T3b 设计 §1.2 实测）。

## 2. 单向同步纪律（即时生效）

- 同步方向**只有真源 → 镜像**。功能改动一律先进真源仓，镜像仅经回灌卡更新（T3a 模式）。**禁止在镜像上开发。**
- 镜像漂移处置：以真源为准回灌——漂移视为真源侧待回灌差异，不做镜像侧就地热修。
- **永久合法残差白名单（3 项，非漂移**，T3b 设计 §1.3 实测）：
  1. `src/shared/protocol.ts` 身份常量（包名 / 插件 id / 版本——T3a §3-1「真源胜」裁决的永久残差）；
  2. `src/compat.ts` 的 compat import 布线（镜像侧用 workspace `@deepseek-ai/dsh-compat`，真源侧用 vendored `./vendor/dsh-compat/index.ts`）；
  3. 真源独有 `src/vendor/dsh-compat/`（vendored 工件，不回灌镜像）。
- 可选加固（planner 裁量，YAGNI 默认不做）：CI drift gate——diff 镜像 `src/` ↔ 真源 `src/`，除上述白名单 3 项外漂移即红。

## 3. 装件化后置卡登记（O-3 域，条件触发）

装件化（出厂装配）属 **O-3「workbench 出厂装配」独立裁决域**（批次4 SYN-B4-closeout §4 身份固化；触发权归用户），登记为条件触发后置卡，本卡不启动、不代裁：

- **触发条件（两条同时满足方可启动）**：
  1. 用户**显式裁决**收编/装配 workbench 进出厂谱；
  2. 真源**三缺口清偿并推云**：`dsh.capabilities`（mount 出口）、`dsh.client`（roster 声明）、factory 形 client bundle（浏览器可消费形态）——缺口清单权威出处 = T3b 设计 §2.2。
- **实施依据**：T3b 设计 §6.4 三阶段草案（阶段 1 真源现代化 → 阶段 2 主仓入谱 → 阶段 3 删 in-tree；阶段 2 全绿前禁启动阶段 3）。
- 后置卡全文：zDSH-docs 仓 `Plan/campaigns/2026-09-27-upgrade-process-v2/T3b-O3-deferred-card.md`。

## 4. T3a 收敛记录（引用）

- 对账表（真源收敛台账）：zDSH-docs 仓 `Plan/campaigns/2026-09-27-upgrade-process-v2/T3a-backfill-ledger.md`。
- 真源侧已完成并推云：`zsagi1368/zdsh-workbench` HEAD = `193af62`（"T3a: converge dual-source fork — backfill in-tree lead, rotate host pin to =0.1.5-rc.2"）。
- 功能面已收敛，残差 = 纯身份/依赖布线层（§2 白名单 3 项）；tests 两侧 17 文件同名同构。
