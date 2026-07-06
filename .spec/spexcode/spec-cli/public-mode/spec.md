---
title: public-mode
hue: 150
desc: Expose the dashboard + API on a public IP behind one password and TLS — one command, no domain, no extra infrastructure.
code:
  - spec-cli/src/gateway.ts
  - spec-cli/src/login-page.ts
related:
  - spec-cli/src/supervise.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/layout.ts
---
# public-mode

The bar: **a developer with only a public IP — no domain, no reverse proxy, no extra tooling — runs one
command and trusted people use the SpexCode dashboard over the internet behind a password, or, when they
choose, with no gate at all.** SpexCode is a fast-lane between people who trust each other, not a public
service; it must never require the apparatus of one (DNS, a CA-issued cert, a separate proxy). **The gate
is opt-in:** a password makes a real login appear; without one the dashboard serves open — and because
dashboard access is effectively remote code execution through the agents, that open choice is loud-warned,
never silent.

`spex serve --public` raises a **gateway** on `0.0.0.0:PORT` — the only thing facing the internet. It
terminates TLS, serves the built dashboard, reverse-proxies `/api/*` and the terminal WebSocket to the
loopback supervisor, and, when `--password <pw>` is given, gates every request behind a login. The
supervisor and its child stay on `127.0.0.1`: **loopback is the trust boundary, the gateway is the
internet face.** Locally launched agents reach the loopback supervisor directly and never carry the
password. Without `--public` nothing changes: dev stays plain
loopback, no TLS, no gate — a pure additive switch over [[spec-cli]]'s supervisor; the dashboard needs no
change (it already calls `/api` same-origin and opens its socket as `wss://` under HTTPS).

**Compression is transport, so it lives at the gateway — once, for every deployment.** Text-ish responses
ship gzipped when the client accepts it, static and proxied alike; upstream and product semantics never
know compression exists. Three exclusions are load-bearing: an SSE stream is
never buffered (event latency), an already-encoded response is not re-encoded, and binary media
(video/image evidence) passes through untouched — it gains nothing and would fight Range requests.

**With a password, the gate is a designed login, not the browser's Basic dialog.** An unauthenticated
visitor gets a styled login page; the posted password is compared in constant time and, on success, mints
a signed `httpOnly` cookie that survives a gateway restart with no server-side session, **named per public
port** (`spex_auth_<port>`) so two same-host gateways — cookies are host-scoped — don't evict each other's
login. That cookie authorises every later request including the same-origin WebSocket upgrade, so the
terminal socket is gated by the same secret with no query-token hack. With no password the login layer is
absent — no `/login`, no cookie check — and every request is served straight through.

**The certificate is a resolved value, never hardcoded.** Precedence: `--tls-cert/--tls-key` flags >
`SPEXCODE_TLS_CERT`/`SPEXCODE_TLS_KEY` env > `spexcode.json` `serve.public.tls` > a self-signed default,
generated once and cached so each visitor accepts it only once. Point it at a real cert and the same
gateway is warning-free HTTPS. `--http` drops TLS entirely — loud-warned, because the password then
crosses the network in clear and secure-context features break. Web PKI won't issue a browser-trusted
cert for a bare IP, so the self-signed default costs one "proceed" click per visitor — the price of
needing no domain, and a default, not a requirement.

**Secrets stay out of the repo; failures are loud.** The password comes only from the flag or env, never
the committable `spexcode.json`; config holds cert file *paths*, the key file lives outside git. A cert
file that does not exist is a named error pointing at the repair, never a silent fallback to insecure
serving.

**The same gateway powers local serve.** [[packaging]]'s `spex dashboard` is this gateway ungated with no
TLS, on loopback by default — its `--host` widens the bind for a private network (LAN/tailnet), and the
gate note keys on the loopback boundary, not on how the host was passed: an ungated loopback bind is
normal, an ungated wide bind is announced at startup. The dist it serves is a resolved location: an
installed `spexcode` serves the bundled `dashboard-dist`; a monorepo checkout falls back to the sibling
`spec-dashboard/dist`.

**A busy port fails loudly.** The gateway obeys [[spec-cli]]'s port-ownership contract: a port already in
use (or permission-denied) is a non-zero exit naming the port and the repair, never a silent or half-up
serve — and `spex serve` and `spex dashboard` answer it identically.
