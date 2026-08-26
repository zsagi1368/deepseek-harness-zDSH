# Browser-trust fence security baseline

English | [中文](browser-trust-fence.zh.md)

This reference is the standing threat model for every request that reaches `/api` on the Web GUI. It records why the trust design is shaped the way it is, what each mechanism does not do, and how to read a refusal. Every change to `trustedHosts`, the bind flags, or [api-request-trust.ts](../../packages/client/connection/src/api-request-trust.ts) is checked against this page before it ships.

## Standing statements

1. **The Host fence is not an authentication layer.** The fence decides whether a request's authority names a server this deployment serves; it never identifies a caller. Network reachability belongs to the webserver configuration, credentials belong outside the browser transport entirely, and no feature may treat passing the fence as identity or authorization.
2. **An all-interfaces bind is refused at the CLI.** `dsh --profile web --host 0.0.0.0` fails at startup: binding every interface would expose the `/api` bridge's remote-code-execution surface to the network while the fence has no authentication layer to lean on ([startup.ts](../../packages/bundle/web-app/src/startup.ts)). LAN serving instead declares authorities — the invocation derives the machine's IP literals itself, and operators add more with `--trusted-host`.
3. **`trustedHosts` is a DNS-rebinding fence, not authorization.** An entry says only "requests naming this authority are not rebinding". A declared authority may reach ordinary catalog reads; it grants nothing on the configuration plane, which the next section pins separately.

## Why the configuration plane stays loopback-only

The attack chain this design breaks, from the S-19 security analysis: an attacker page loads in the operator's browser, DNS rebinding points its fetches at `127.0.0.1:<port>` while the Host header still carries the attacker's domain, and if that request reached the RPC bridge, `settings.update` could repoint a provider's base URL at a server the attacker controls — after which the harness forwards conversation content, API keys, and credential material to that server on its next call.

Two independent pins break every leg of that chain:

1. The Host fence refuses the rebound request outright (`forbidden (untrusted-host)`): the attacker can forge URLs but not the Host header of the socket that lands on this server.
2. Even where the operator deliberately declared `trustedHosts` for LAN serving, every method in `PRIVILEGED_METHODS` re-runs the same fence against an **empty** trust list before the bridge runs ([index.ts](../../packages/client/connection/src/index.ts)). A LAN caller asking for `settings.update`, `credentials.set`, or any other configuration-plane method gets `403 forbidden (untrusted-host)`; only loopback passes.

Reads on that plane are pinned exactly as hard as writes: `settings.describe` returns every exposed namespace's configuration, `credentials.describe` reports whether an arbitrary environment-variable name is configured, and `llm.discoverModels` makes the host fetch a caller-chosen URL. The model catalog (`llm.providers`, `llm.models`) is deliberately not pinned: a LAN client's model picker needs it, and it carries provider ids and model lists but no endpoints or key state.

The consequence for evolution: widening any privileged method beyond loopback requires a real authentication layer first. Fence exceptions, origin relaxations, and header allowlists are not substitutes.

## Reading a diagnostic 403

A refused `/api` request answers with status 403, body `forbidden (<reason>)`, and an `x-dsh-api-trust` header carrying the same reason. At boot the Web app probes its own `/api` once through the exact address it printed and renders guidance when refused ([api-selfcheck.ts](../../packages/bundle/web-app/src/api-selfcheck.ts)), so the lockout shapes below surface at startup rather than as silent page breakage.

| Reason | Meaning | Typical cause |
|---|---|---|
| `missing-host` | The request carried no Host header. | A raw socket client or a proxy stripping headers. |
| `bad-host` | The Host header did not parse as an authority. | Broken rewriting by proxy or security software. |
| `untrusted-host` | The Host is neither loopback nor a declared authority. | Opened via an undeclared LAN name or IP; DNS rebinding; a rewritten Host. |
| `cross-site` | The browser labeled the request `sec-fetch-site: cross-site`. | A request fired from another site. |
| `opaque-origin` | The Origin was the literal `null` or not http(s). | Sandboxed iframe, `file:` page, extension page. |
| `origin-mismatch` | An attached Origin named another server. | Header rewriting between the browser and the server. |

The remedies for a lockout are the two the startup guidance prints: open the exact address the server printed, or declare the authority you actually reach it by with `--trusted-host <host[:port]>`.

## Regression coverage

- Fence decisions per request shape: [api-request-trust.host.spec.ts](../../packages/client/connection/tests/api-request-trust.host.spec.ts).
- Privileged methods answering 403 to a declared LAN authority, over fakes and real HTTP: [node-half.host.spec.ts](../../packages/client/connection/tests/node-half.host.spec.ts).
- Startup self-probe classification and guidance: [api-selfcheck.spec.ts](../../packages/bundle/web-app/tests/api-selfcheck.spec.ts).
