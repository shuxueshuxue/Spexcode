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

## raw source

The bar this node is held to: **a developer with only a public IP — no domain, no reverse proxy, no
extra tooling — runs one command and trusted people use the SpexCode dashboard over the internet behind
a password — or, when they choose, with no gate at all.** If that is not true, the design is wrong.
SpexCode is a technical fast-lane between people who trust each other, not a public service; it must never
require the apparatus of one (DNS, a CA-issued cert, a separate proxy) to stand up. **The gate is opt-in:**
a password makes a real login appear; without one the dashboard is served open. Because access to the
dashboard is effectively remote code execution through the agents, an open public deployment is loud-warned
— the operator chooses, but the choice is never silent in either direction.

## expanded spec

`spex serve --public` raises a **gateway** on `0.0.0.0:PORT` that is the only thing facing the internet. It
terminates TLS, serves the built dashboard, reverse-proxies `/api/*` and the terminal WebSocket to the
loopback supervisor, and — **when `--password <pw>` is given** — gates every request behind a login. The supervisor and its
child stay bound to `127.0.0.1`; **loopback is the trust boundary, the gateway is the internet face.**
Locally launched agents reach the loopback supervisor directly, so they never carry the password — only
outside traffic meets the gate. Without `--public` nothing changes: dev stays plain loopback, no TLS, no
gate. This is a pure additive switch over [[spec-cli]]'s supervisor; the dashboard needs no change (it
already calls `/api` same-origin and opens its socket as `wss://` under HTTPS).

**When a password is set, the gate is a designed login, not the browser's Basic dialog.** An unauthenticated
visitor gets a styled SpexCode login page; the posted password is compared in constant time and, on success,
mints a signed `httpOnly` cookie (derived from the password via HMAC, so it survives a restart and stores no
server-side session). The cookie authorises every later request including the WebSocket upgrade — the browser
sends it on the same-origin handshake, so the terminal socket is gated by the same secret with no query-token
hack. With **no** password the whole login layer is absent — no `/login`, no cookie check — and every request
is served straight through; the operator has chosen open access (and was warned).

**The certificate is a resolved value, never hardcoded.** Precedence: `--tls-cert/--tls-key` flags > the
`SPEXCODE_TLS_CERT`/`SPEXCODE_TLS_KEY` env > `spexcode.json` `serve.public.tls` > a **self-signed default**,
generated once and cached so visitors accept it only once. Point the flags at a real cert (e.g. Let's
Encrypt `fullchain.pem`/`privkey.pem`) and the same gateway is warning-free HTTPS the moment a domain
exists. `--http` drops TLS entirely — loud-warned, because the password then crosses the network in clear
and secure-context features (clipboard) break — for someone who knowingly wants zero friction. The one
unavoidable cost: web PKI will not issue a browser-trusted cert for a bare IP, so the self-signed default
costs a single "proceed" click per visitor — that is the price of needing no domain, and it is the default,
not a requirement.

**Secrets stay out of the repo, and failures are loud.** The password is taken only from the flag or env,
never the committable `spexcode.json`; config holds cert file *paths*, the key file lives outside git.
`--public` with no password serves open with a loud warning (never a silent exposure); a cert file that does
not exist is a named error pointing at the repair, never a silent fallback to insecure serving.
