# Run the Web UI in the background

English | [中文](background-service.zh.md)

`dsh web` boots in the foreground by design: Ctrl+C stops it, and the process has no daemon mode. This page supplies copy-paste supervisor configs for keeping the server alive after the terminal, SSH session, or login window closes. Every config wraps the same command from a completed [source checkout](../../../apps/cli/reference/README.md#source-execution); nothing inside `dsh` changes.

The supervised command is `pnpm dsh web --no-open`, run from the repository root. `--no-open` matters under a supervisor: boot never attempts the default-browser handoff, so no headless start dies trying to open a window.

## How this relates to the `dsh web` lifecycle

- **Graceful stop is SIGTERM.** The first signal starts a bounded drain that disposes the plugin tree within five seconds; a second signal forces immediate exit. systemd and launchd send `SIGTERM` by default and NSSM tries a console stop first, so all three give the drain room. The Task Scheduler's Stop action force-terminates instead.
- **The working directory is the default workspace.** The invoking directory becomes the default filesystem location, so point each config's working-directory key at the checkout you normally launch from.
- **One instance owns port 3080.** A second boot fails to bind `127.0.0.1:3080`; stop the running instance before starting another one, including across upgrades: stop, `git pull && pnpm install && pnpm run build`, start. The old process keeps serving old artifacts until it is restarted.
- **Loopback stays the boundary.** The CLI rejects `--host 0.0.0.0`; reach the UI from another device through the [Tailscale guide](../../../docs/dsh/remote-access.md), adding `--trusted-host <name>` when a proxy forwards under another authority.
- **Logs go where the supervisor writes them**, not to your terminal; each config below names its file.

## Windows: Task Scheduler

Register an at-logon task with restart-on-failure from PowerShell:

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

`Stop-ScheduledTask -TaskName "zDSH Web"` stops the task by force-termination and skips the graceful drain. Start-at-boot, highest privileges, and more restart rounds are configurable in the Task Scheduler GUI.

## Windows: NSSM service

[NSSM](https://nssm.cc) runs the same command as a real Windows service whose stop path tries a console stop before terminating:

```text
nssm install zDSHWeb cmd.exe /c "<absolute-pnpm>" dsh web --no-open
nssm set zDSHWeb AppDirectory C:\path\to\deepseek-harness-zDSH
nssm set zDSHWeb AppStdout C:\path\to\deepseek-harness-zDSH\dsh-web.log
nssm set zDSHWeb AppStderr C:\path\to\deepseek-harness-zDSH\dsh-web.log
nssm start zDSHWeb
```

Resolve `<absolute-pnpm>` once with `where.exe pnpm`: a service inherits the system PATH, which does not include the per-user pnpm directory. `nssm restart zDSHWeb` picks up upgraded artifacts after a rebuild.

## Linux: systemd user unit

Save as `~/.config/systemd/user/zdsh-web.service`:

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

`ExecStart` needs an absolute binary — substitute what `command -v pnpm` prints. Enable the unit and keep it alive after logout:

```sh
systemctl --user daemon-reload
systemctl --user enable --now zdsh-web
loginctl enable-linger "$USER"
journalctl --user -u zdsh-web -f
```

Without `enable-linger`, the user manager kills user units at the last logout — exactly the closure this page exists to survive. `systemctl --user stop zdsh-web` sends the graceful `SIGTERM`.

## macOS: launchd agent

Save as `~/Library/LaunchAgents/com.zdsh.web.plist`:

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

Intel Macs install Homebrew under `/usr/local`, so substitute that prefix when `command -v pnpm` prints it. Load and manage the agent:

```sh
launchctl bootstrap gui/"$(id -u)" ~/Library/LaunchAgents/com.zdsh.web.plist
launchctl kickstart -k gui/"$(id -u)"/com.zdsh.web
launchctl bootout gui/"$(id -u)" ~/Library/LaunchAgents/com.zdsh.web.plist
```

`bootout` sends `SIGTERM` first, so the drain runs before the process leaves.
