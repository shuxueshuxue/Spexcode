# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately** — do not open a public GitHub issue for them.

Contact the maintainer privately through their GitHub profile
([@shuxueshuxue](https://github.com/shuxueshuxue)). If the repository's **Security → Report a
vulnerability** button is available (GitHub's private vulnerability reporting — not always enabled),
that flow works too: it opens a private advisory visible only to you and the maintainers.

Please include enough to reproduce: the version (the installed `spexcode` npm package version, or the
commit), your OS and Node version, the steps, and what you expected versus what happened. There is no
fixed response SLA; you'll be kept updated on any fix.

## Trust model — read this before exposing SpexCode

SpexCode is a **developer tool that runs on a developer's own machine against code they trust**, and its
threat model follows from that. Two properties matter:

### 1. The session layer runs an agent that can execute arbitrary commands

SpexCode's session layer dispatches AI workers that drive a coding-agent harness — **Claude
Code or Codex**. By default the agent runs with permission prompts disabled (Claude
`--dangerously-skip-permissions`, Codex `--yolo`; the launch command comes from the named launcher
profiles in `spexcode.json`/`spexcode.local.json`): it can **read, write, and execute** on your machine
without per-action prompts — the git worktree is its working directory, not a sandbox. The dashboard's
live "Sessions" console is a **real terminal** over a WebSocket — i.e. shell access to the host.

This is intended for an interactive, single-operator setup. It also means:

- **Only run SpexCode on repositories and prompts you trust.** An untrusted spec, prompt, or repo can
  cause the agent to run commands on your machine. Treat dispatching a worker like running a script the
  repo handed you.
- The standalone **governance layer** (`spex spec lint`, `spex init`, the spec tree, the dashboard's
  read-only views, the git-as-database reader) does **not** launch an agent and does not carry this
  risk. You can adopt and use that layer without ever enabling the session layer.

### 2. Network exposure — what listens where, and the password gate

`spex serve` (the API + session backend) and `spex serve ui` (the dashboard) are **unauthenticated**:
they assume the only client is you, on a host and network you trust.

- `spex serve ui` binds **loopback only** by default; `--host` widens the bind (announced at startup).
- `spex serve` **listens on all interfaces** (its child backend stays on loopback, but the supervisor's
  port — 8787 by default — is reachable from any network the host is on). If the host sits on a network
  you don't fully trust, firewall the port or gate it as below.

To reach SpexCode from another machine, use the built-in gateway rather than exposing the raw ports:
**`spex serve --public --password <pw>`** (password also via `SPEXCODE_PASSWORD`) raises a TLS gateway
on the public port that gates every request — including the terminal WebSocket — behind a login page and
a signed `HttpOnly` cookie, while the backend retreats to a loopback-only port.

- **Never expose an ungated port to an untrusted network.** Use `--public --password`, or put your
  own authenticated tunnel in front (SSH, a VPN like Tailscale, or an authenticating reverse proxy).
  Because the session socket is a live terminal, an open port is equivalent to an unauthenticated
  shell. `--public` with **no** password serves the dashboard open — loud-warned at startup, never a
  silent exposure — so the password is on you to set.
- `--public --http` drops TLS: the password crosses the network in clear (also loud-warned), and the
  dashboard loses browser secure-context APIs (e.g. clipboard).

## Supported versions

SpexCode is pre-1.0 and ships from `main`. Security fixes land on `main` and in the latest published
`spexcode` npm release; there are no maintained back-port branches yet. Run a recent version.
