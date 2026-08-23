# 通过 Tailscale 远程访问 Web UI

[English](remote-access.md) | 中文

本指南使用 Tailscale Serve 把运行在工作站上的 zDSH Web UI 发布到你自己的 tailnet，让同一私网内的手机或平板浏览器可以远程驱动会话。整个过程不暴露到公网；这正是官方讨论 #229 所诉求的部署方式（[deepseek-harness#229](https://github.com/deepseek-ai/deepseek-harness/discussions/229)）。UI 在视口宽度 768px 及以下渲染移动端布局，因此一旦 URL 可达，手机浏览器就是一等公民。

## 前置条件

- Web UI 已在本地以 `dsh web` 启动。它绑定回环地址 `127.0.0.1`（除非另行配置，端口为 `3080`），并打印所服务的本地 URL。
- 工作站和手机都已安装并登录 Tailscale，两台设备都出现在同一 tailnet 的管理控制台中。

## 用 Tailscale Serve 发布

1. 在工作站上，把本地 UI 以 HTTPS 发布到 tailnet：

   ```bash
   tailscale serve --bg http://127.0.0.1:3080
   ```

   较旧的 Tailscale 客户端使用等价形式 `tailscale serve https / http://127.0.0.1:3080`。命令会打印 tailnet URL，例如 `https://workstation.tail1234.ts.net`。
2. 在手机浏览器中打开该 URL，如出现 Tailscale 登录提示则完成登录。手机此后经 tailnet 隧道与工作站的回环服务器通信。

停止发布：运行 `tailscale serve reset`（旧版客户端为 `tailscale serve --https=443 off`）。

## 浏览器信任栅栏与 Host 名称

每个 `/api` 请求都要通过一道浏览器信任栅栏，用于保护回环服务器免受 DNS 重绑定与跨站请求：请求的 `Host` 头必须是回环名称或其他显式受信权威。直接落在 `127.0.0.1` 上的请求天然满足该栅栏；而 Tailscale Serve 这类反向代理可能以你机器的 tailnet DNS 名转发请求，此时栅栏会以禁止响应拒绝，声明该权威即可修复：

```bash
dsh web --trusted-host workstation.tail1234.ts.net
```

该标志可重复传入，接受裸 `host`（任意端口）或 `host:port`（精确端口），并为本次调用把该权威加入栅栏。

## 安全基线

- 保持回环绑定。不要为了触达手机而用 `--host 0.0.0.0` 启动；tailnet 隧道已经提供了私网可达性，全接口绑定只会把攻击面扩大到所有 LAN 邻居。
- 不要对本 GUI 使用 `tailscale funnel`。funnel 会把 URL 发布到公网，而 Web UI 尚未提供服务端认证——上文的信任栅栏只是抗重绑定与跨站加固，并非登录。这与官方讨论 #130 中记录的共同立场一致（[deepseek-harness#130](https://github.com/deepseek-ai/deepseek-harness/discussions/130)）。
- tailnet 成员资格即访问控制。在 Tailscale 管理控制台移除设备即可立即吊销其可达性。

## 常见问题

- **首次访问出现证书告警**：`*.ts.net` 名称会自动签发公开受信的证书，但首次签发可能需要一分钟，稍后重试即可；手机所在网络中的企业 TLS 审查代理也可能破坏证书链——请在无拦截的网络下测试。
- **API 调用返回禁止错误**：Host 栅栏拒绝了代理后的权威；按上文方式用 `--trusted-host` 加入确切的 tailnet 主机名。
- **代码变更后 UI 陈旧**：只有当同一检出内同时运行 `pnpm run dev:web` 时，client-plugin 才能热重载；其余任何变更都需要重建 web 产物并刷新页面。远程手机在此处与其他浏览器客户端行为一致。
- **重启后 URL 失效**：以 `--port 0` 启动会让操作系统每次开机挑选新端口；读取启动时打印的 URL 行，并用 `tailscale serve` 重新发布该端口。
