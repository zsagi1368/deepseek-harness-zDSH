# 让 Web 服务常驻后台

[English](background-service.md) | 中文

`dsh web` 默认在前台运行：Ctrl+C 即停止，进程本身没有 daemon 模式。本页给出可直接复制的监督器配置，让服务器在终端、SSH 会话或登录窗口关闭之后继续存活。每份配置包裹的都是同一个命令，前提是已完成[源码执行](../../../apps/cli/reference/README.zh.md#source-execution)要求的准备；`dsh` 内部没有任何改变。

被监督的命令是从仓库根目录运行的 `pnpm dsh web --no-open`。在监督器下 `--no-open` 很重要：启动过程绝不尝试把地址交给默认浏览器，无头启动不会因为试图打开窗口而失败。

## 与 `dsh web` 生命周期的关系

- **优雅停止就是 SIGTERM。** 第一个信号触发有界排空：至多五秒内卸载插件树；第二个信号强制立即退出。systemd 与 launchd 默认发送 `SIGTERM`，NSSM 先尝试控制台停止，三者都给排空留了余地。任务计划程序的“停止”则是强制结束。
- **工作目录就是默认工作区。** 启动时所在目录会成为默认文件系统位置，所以把每份配置的工作目录键指向你平时启动所用的 checkout。
- **一个实例独占端口 3080。** 第二次启动会因绑定不上 `127.0.0.1:3080` 而失败；先停掉在跑实例再起新实例，升级也一样：停止、`git pull && pnpm install && pnpm run build`、启动。旧进程在被重启前一直服务旧的构建产物。
- **环回地址仍是边界。** CLI 拒绝 `--host 0.0.0.0`；从其他设备访问请走 [Tailscale 指南](../../../docs/dsh/remote-access.zh.md)，当代理以别的 authority 转发时再加 `--trusted-host <name>`。
- **日志写在监督器安排的地方**，而不是你的终端；下面每份配置都指明了自己的文件。

## Windows：计划任务

用 PowerShell 注册一个登录时运行、失败自动重启的任务：

```powershell
$repo = "C:\path\to\deepseek-harness-zDSH"
$pnpm = (Get-Command pnpm).Source
$action = New-ScheduledTaskAction -Execute "$env:ComSpec" `
  -Argument "/c cd /d `"$repo`" && `"$pnpm`" dsh web --no-open >> `"$repo\dsh-web.log`" 2>&1"
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName "zDSH Web" -Action $action -Trigger $trigger -Settings $settings
Start-ScheduledTask -TaskName "zDSH Web"
```

`Stop-ScheduledTask -TaskName "zDSH Web"` 以强制结束的方式停止任务，跳过优雅排空。开机自启（登录前）、最高权限与更多重启次数可在“任务计划程序”GUI 中调整。

## Windows：NSSM 服务

[NSSM](https://nssm.cc) 把同一条命令包装成真正的 Windows 服务，其停止路径会先尝试控制台停止再终止：

```text
nssm install zDSHWeb cmd.exe /c "<absolute-pnpm>" dsh web --no-open
nssm set zDSHWeb AppDirectory C:\path\to\deepseek-harness-zDSH
nssm set zDSHWeb AppStdout C:\path\to\deepseek-harness-zDSH\dsh-web.log
nssm set zDSHWeb AppStderr C:\path\to\deepseek-harness-zDSH\dsh-web.log
nssm start zDSHWeb
```

先用 `where.exe pnpm` 解析一次 `<absolute-pnpm>`：服务继承的是系统 PATH，不包含用户级的 pnpm 目录。重新构建后用 `nssm restart zDSHWeb` 换上升级后的产物。

## Linux：systemd user unit

保存为 `~/.config/systemd/user/zdsh-web.service`：

```ini
[Unit]
Description=zDSH Web UI
After=network-online.target

[Service]
Type=simple
WorkingDirectory=%h/deepseek-harness-zDSH
ExecStart=/usr/bin/pnpm dsh web --no-open
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```

`ExecStart` 需要绝对路径的二进制——替换成 `command -v pnpm` 的输出。启用该单元并让它在登出后继续存活：

```sh
systemctl --user daemon-reload
systemctl --user enable --now zdsh-web
loginctl enable-linger "$USER"
journalctl --user -u zdsh-web -f
```

没有 `enable-linger`，用户管理器会在最后一次登出时杀掉 user unit——这正是本页要活过场的场景。`systemctl --user stop zdsh-web` 发送的是优雅的 `SIGTERM`。

## macOS：launchd agent

保存为 `~/Library/LaunchAgents/com.zdsh.web.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key>
    <string>com.zdsh.web</string>
    <key>WorkingDirectory</key>
    <string>/Users/you/deepseek-harness-zDSH</string>
    <key>ProgramArguments</key>
    <array>
      <string>/opt/homebrew/bin/pnpm</string>
      <string>dsh</string>
      <string>web</string>
      <string>--no-open</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/zdsh-web.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/zdsh-web.log</string>
  </dict>
</plist>
```

Intel Mac 的 Homebrew 前缀是 `/usr/local`，若 `command -v pnpm` 输出该前缀请相应替换。加载与管理：

```sh
launchctl bootstrap gui/"$(id -u)" ~/Library/LaunchAgents/com.zdsh.web.plist
launchctl kickstart -k gui/"$(id -u)"/com.zdsh.web
launchctl bootout gui/"$(id -u)" ~/Library/LaunchAgents/com.zdsh.web.plist
```

`bootout` 先发送 `SIGTERM`，排空完成后进程才退出。
