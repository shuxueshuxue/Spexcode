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

SpexCode's self-developing feature dispatches AI workers that drive a coding-agent harness — **Claude
Code or Codex**. By default the agent runs with permission prompts disabled (Claude
`--dangerously-skip-permissions`, Codex `--yolo`; the Claude launcher is overridable via
`SPEXCODE_CLAUDE_CMD`): it can **read, write, and execute** in its git worktree without per-action
prompts. The board's live "Sessions" console is a **real terminal** over a WebSocket — i.e. shell access
to the host.

This is intended for an interactive, single-operator setup. It also means:

- **Only run SpexCode on repositories and prompts you trust.** An untrusted spec, prompt, or repo can
  cause the agent to run commands on your machine. Treat dispatching a worker like running a script the
  repo handed you.
- The standalone **governance layer** (`spex lint`, `spex init`, the spec tree, the dashboard's
  read-only views, the git-as-database reader) does **not** launch an agent and does not carry this
  risk. You can adopt and use that layer without ever enabling the session layer.

### 2. Remote exposure is opt-in and password-gated

`spex serve` (the API + session backend) and `spex dashboard` bind to **localhost** by default and are
**unauthenticated there** — loopback is the trust boundary, on the assumption the only client is you, on
the same host.

To reach SpexCode from another machine, use the built-in gateway rather than exposing the loopback ports
directly: **`spex serve --public --password <pw>`** raises a TLS gateway on the public port that gates
every request — including the terminal WebSocket — behind a styled login and a signed `httpOnly` cookie,
while the backend itself stays bound to loopback.

- **Never expose the raw loopback ports to an untrusted network.** Use `--public --password`, or put your
  own authenticated tunnel in front (SSH, a VPN like Tailscale, or an authenticating reverse proxy) —
  never a bare unauthenticated port. Because the session socket is a live terminal, an open port is
  equivalent to an unauthenticated shell — so `--public` with **no** password serves open and is
  loud-warned, never a silent exposure.
- Served over plain HTTP (`--http`), the dashboard loses browser secure-context APIs (e.g. clipboard) and
  any password crosses the network in clear; that's a functional/operational limitation, not the security
  boundary.

## Supported versions

SpexCode is pre-1.0 and ships from `main`. Security fixes land on `main` and in the latest published
`spexcode` npm release; there are no maintained back-port branches yet. Run a recent version.
