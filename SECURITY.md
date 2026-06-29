# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately** — do not open a public GitHub issue for them.

Use GitHub's **private vulnerability reporting**: go to the repository's **Security → Advisories →
Report a vulnerability**, which opens a private advisory visible only to you and the maintainers. If you
cannot use that flow, contact a maintainer privately through their GitHub profile.

Please include enough to reproduce: the version (`spex --version` or the commit), your OS and Node
version, the steps, and what you expected versus what happened. We aim to acknowledge a report within a
few days. As a young project we don't yet promise a fixed SLA, but credible reports are taken
seriously and we'll keep you updated on the fix.

## Trust model — read this before exposing SpexCode

SpexCode is a **developer tool that runs on a developer's own machine against code they trust**, and its
threat model follows from that. Two properties matter:

### 1. The session layer runs an agent that can execute arbitrary commands

SpexCode's self-developing feature dispatches AI workers that drive a coding agent. By default that
agent is launched as `claude --dangerously-skip-permissions` (overridable via `SPEXCODE_CLAUDE_CMD`):
it can **read, write, and execute** in its git worktree without per-action prompts. The board's live
"Sessions" console is a **real terminal** over a WebSocket — i.e. shell access to the host.

This is intended for an interactive, single-operator setup. It also means:

- **Only run SpexCode on repositories and prompts you trust.** An untrusted spec, prompt, or repo can
  cause the agent to run commands on your machine. Treat dispatching a worker like running a script the
  repo handed you.
- The standalone **governance layer** (`spex lint`, `spex init`, the spec tree, the dashboard's
  read-only views, the git-as-database reader) does **not** launch an agent and does not carry this
  risk. You can adopt and use that layer without ever enabling the session layer.

### 2. The backend and dashboard are not hardened for hostile networks

`spex serve` (the API + session backend) and `spex dashboard` bind to **localhost** by default. They
have **no authentication layer** — they assume the only client is you, on the same host.

- **Do not expose the backend or dashboard to an untrusted network.** Because the session socket is a
  live terminal, exposing the port is equivalent to exposing an unauthenticated shell. If you need
  remote access, put it behind your own authenticated tunnel (SSH, a VPN like Tailscale, or an
  authenticating reverse proxy) — never a bare public port.
- Served over plain HTTP, the dashboard loses browser secure-context APIs (e.g. clipboard); that's a
  functional limitation, not a security boundary — see "known limitations" in [`README.md`](./README.md).

## Supported versions

SpexCode is pre-1.0 and ships from `main`. Security fixes land on `main` and in the latest published
`spexcode` npm release; there are no maintained back-port branches yet. Run a recent version.
