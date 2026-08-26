# `@deepseek-ai/dsh`

[English](README.md) | 中文

`dsh` 是 DeepSeek Harness 中用于启动 profile 的命令；profile 由多个插件组合包 patch 层按顺序叠加而成，其上再应用用户自己的覆盖配置。[`src/args.ts`](src/args.ts) 负责命令语法，[`src/bin.ts`](src/bin.ts) 只加载选中的运行器。无效命令、来自其他模式的选项、配置错误和启动失败都会以非零状态退出。

## 入口模式

| 命令 | 用途 |
|---|---|
| `dsh --profile <name>` | 启动位于 `$DSH_HOME/profiles/<name>` 的指定 profile。 |
| `dsh --profile headless "job"` | 运行一个全新的持久化会话，打印最终答案并退出。 |
| `dsh web` | `--profile web` 的别名。 |
| `dsh acp` | 通过 Agent Client Protocol（JSON-RPC stdio）对外部 GUI 客户端提供 DeepSeek Harness 服务。 |
| `dsh plugin --profile <name> <pnpm args>` | 通过在 profile 目录中转发给 pnpm 来管理该 profile 的插件。 |

运行命令时所在的目录将作为默认 workspace 根目录。`web` 和 `headless` profile 在首次使用时会从随附模板自动初始化；其他任何 profile 都必须通过 `dsh plugin` 创建。

## ACP 入口

`dsh acp` 是面向外部工作台的稳定入口，供其通过 [Agent Client Protocol](https://agentclientprotocol.com) 接入：该命令启动一份标准 profile 组合，并在其上挂载 `@deepseek-ai/dsh-acp` 桥接层，随后在 stdin/stdout 上提供 JSON-RPC 服务。stdout 只承载协议帧（无横幅、无进度行）；诊断信息走 stderr。`--provider <name>` 与 `--model <id>` 为桥接创建的会话选择模型路由；`--dump-config` 打印组合后的配置树（含桥接行）。

```sh
dsh acp                                        # default profile `acp`, composition model defaults
dsh acp --provider deepseek-official --model deepseek-v4-pro
dsh acp --dump-config                          # inspect the tree without booting
```

`acp` profile（仅基础组合包，不预建 agent）会在首次使用时自动初始化；指定 `--profile <name>` 则改为服务任一既有 profile 的组合。ACP 客户端是受信任的程序化对端：它可以在与其他所有入口相同的权限瀑布下驱动完整的 harness（`DSH_PERMISSION_MODE` 原样生效），且权限答复永远不会被推断为持久授权。

## 首次运行预期

第一次运行 `npx --yes @deepseek-ai/dsh web` 时，npx 会先下载并解压完整的依赖树，然后才开始执行任何代码，因此首次启动出现数分钟无输出（仅有 npm 警告）属正常现象——请耐心等待，不要终止进程；后续启动会命中缓存，速度很快。网络较慢时，可先将 npm 指向镜像源以显著提速：`npm config set registry https://registry.npmmirror.com`。启动器自身开始运行后，会打印一条标明版本与所启动 profile 的横幅（附带同样的首启提示）；交互式终端上还会为每个启动阶段输出一行进度（配置解析完成、插件装载完成）。管道输出与机器模式（`--dump-config`、`dsh plugin`）保持静默。

## Windows 控制台窗口

在部分 Windows 终端宿主上，`dsh web` 把 URL 交给默认浏览器时会闪出第二个后端控制台窗口。可在禁用浏览器交接的情况下启动，然后手动打开打印出的 URL：

```sh
dsh web --no-open
```

## 应用参数

启动器只解析自身的 flag，并将其后的所有内容交给已启动的 profile；注入该 profile 的任意应用插件都可以解析这份共享的不可变快照（[`dsh-cmdline`](../../packages/boot/cmdline/README.zh.md)）。因此，启动器的 flag 必须写在最前面；启动器无法识别的第一个 token 标志着应用参数的开始：

```sh
dsh --profile web --port 8080       # --port belongs to the web app
dsh --profile tui --resume <id>     # example, assuming the tui profile is installed; --resume belongs to the terminal app
dsh --profile headless "run the tests"
dsh --profile web --help            # the web app's flags, not the launcher's
dsh --help                          # the launcher's own help
```

<a id="profiles"></a>

## Profile

profile 目录包含一个 `package.json`，其中记录树外插件依赖，以及 profile manifest（元数据清单）`dsh.profile` 和其中按顺序排列的 `bundles` 列表；还包含一个 `cordis.patch.yml`，其中保存用户自己的 patch 层。

配置树以空根为起点，依次叠加以下配置层：
- `dsh.profile.bundles` 中各组合包的 patch
- profile 自身的 `cordis.patch.yml`，然后是 home 级的 `$DSH_HOME/cordis.patch.yml`
- `--patch` 指定的覆盖层

`dsh.profile.bundles` 中列出的组合包先从 dsh 安装目录解析（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-headless`），再从 profile 自身的 `node_modules` 解析；pnpm 会将树外插件安装到该目录。

使用 `--dump-default-config` 和 `--dump-config` 可在不启动的情况下检查组合后的配置树。

层的确切优先级、flag、关闭行为、部署默认值和源码执行方式，以 [CLI（命令行界面）行为参考](reference/README.zh.md)为准。

## 开发

生产运行需要已构建的包与前端产物。请在仓库根目录单独运行 `pnpm run build`，然后使用 `pnpm dsh <args...>` 运行 TypeScript 入口并转发所有参数；模块解析约定以[源码执行参考](reference/README.zh.md#source-execution)为准。
