# Remote access to the Web UI over Tailscale

English | [中文](remote-access.zh.md)

This guide publishes the zDSH Web UI that runs on your workstation to your own tailnet with Tailscale Serve, so a phone or tablet browser on the same private network can drive sessions remotely. Nothing reaches the public internet; this is exactly the deployment the official discussion #229 asks about ([deepseek-harness#229](https://github.com/deepseek-ai/deepseek-harness/discussions/229)). The UI renders its mobile layout at viewport widths of 768px and below, so a phone browser is a first-class citizen once the URL is reachable.

## Prerequisites

- The Web UI boots locally with `dsh web`. It binds the loopback address `127.0.0.1` (port `3080` unless configured otherwise) and prints the local URL it serves.
- Tailscale is installed and logged in on both the workstation and the phone, and both devices show up in the same tailnet's admin console.

## Publish with Tailscale Serve

1. On the workstation, publish the local UI to the tailnet over HTTPS:

   ```bash
   tailscale serve --bg http://127.0.0.1:3080
   ```

   Older Tailscale clients use the equivalent form `tailscale serve https / http://127.0.0.1:3080`. The command prints the tailnet URL, for example `https://workstation.tail1234.ts.net`.
2. Open that URL in the phone's browser and accept the Tailscale sign-in prompt if one appears. The phone now talks to the workstation's loopback server through the tailnet tunnel.

To stop publishing, run `tailscale serve reset` (or `tailscale serve --https=443 off` on older clients).

## The browser-trust fence and Host names

Every `/api` request passes a browser-trust fence that defends the loopback server against DNS rebinding and cross-site requests: the request's `Host` header must be a loopback name or another explicitly trusted authority. Requests that arrive directly on `127.0.0.1` satisfy the fence by construction. A reverse proxy such as Tailscale Serve may forward requests under your machine's tailnet DNS name instead, and the fence then rejects them with forbidden responses; declaring the authority fixes it:

```bash
dsh web --trusted-host workstation.tail1234.ts.net
```

The flag is repeatable, accepts a bare `host` (any port) or `host:port` (that exact port), and adds the authority to the fence for this invocation.

## Security baseline

- Keep the loopback bind. Never launch with `--host 0.0.0.0` just to reach the phone; the tailnet tunnel already provides private reachability, and an all-interfaces bind widens the attack surface to every LAN neighbor.
- Do not use `tailscale funnel` for this GUI. Funnel publishes the URL to the public internet, and the Web UI does not ship server-side authentication yet — the trust fence above is anti-rebinding and cross-site hardening, not a login. This matches the shared position recorded in official discussion #130 ([deepseek-harness#130](https://github.com/deepseek-ai/deepseek-harness/discussions/130)).
- Tailnet membership is the access control. Removing a device in the Tailscale admin console revokes its reachability immediately.

## Troubleshooting

- **Certificate warning on first visit**: `*.ts.net` names are issued a publicly trusted certificate automatically, but the first provisioning can take a minute; retry shortly. A corporate TLS-inspecting proxy on the phone's network can also break the chain — test on a network without interception.
- **Forbidden errors on API calls**: the Host fence rejected the proxied authority; add the exact tailnet hostname with `--trusted-host` as shown above.
- **Stale UI after code changes**: client-plugin hot reloads work only while `pnpm run dev:web` runs from the same checkout; every other change requires rebuilding the web artifacts and refreshing the page. A remote phone behaves like any other browser client here.
- **URL stopped working after a restart**: launching with `--port 0` lets the OS pick a fresh port each boot; read the URL line printed at startup and re-publish that port with `tailscale serve`.
