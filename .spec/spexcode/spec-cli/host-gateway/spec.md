---
title: host-gateway
hue: 180
desc: One `spex dashboard` for every project a user serves — instance-validated endpoint records reconciled into a live project list, proxied per project via /p/:projectId/*.
code:
  - spec-cli/src/host.ts
related:
  - spec-cli/src/supervise.ts
  - spec-cli/src/gateway.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/index.ts
  - spec-cli/src/layout.ts
  - spec-cli/src/host.test.ts
---
# host-gateway

The bar: **a user who runs several SpexCode projects on one machine opens ONE dashboard and reaches all
of them — no `--api-port` pairing, no per-project UI process, no "current project" toggle.** Each
backend stays exactly what it is — one `spex serve` per repo, loopback-only, auth-unaware, ignorant of
every other project; the HOST level is where multiplicity lives, and this node is that level.

**The seam between the two levels is the endpoint record.** After its public bind succeeds, a serve
ATOMICALLY (tmp + rename — a reader never sees a torn record) publishes `{url, pid, instanceId, root,
startedAt}` into the existing per-user global project store (`~/.spexcode/projects/<enc>/backend.json`)
and, on a clean stop, removes only a record that still carries its own `instanceId` — never a newer
serve's, never another project's. The `instanceId` is minted once per serve lifetime and handed to every
child through env, so the identity is stable across zero-downtime reloads; the child answers it (with the
root it serves) at `GET /api/instance`. A record is therefore *checkable*, not just present: the reader
compares the record's `instanceId` + `root` against the live answer at its `url`, and only a full match
counts as online. A crashed serve, a recycled port now serving something else, or a record copied into
the wrong store slot (the slot must equal `encodeProject(root)`) all fail the match and degrade to
"offline project" — never a proxy to the wrong backend.

**`spex dashboard` is the single host gateway over those records.** It continuously reconciles every
current-user record (single-flight, a few seconds' cadence plus on-demand), emits the validated project
list at `GET /api/host/projects` and as a live SSE stream at `/api/host/projects/stream`, and serves the
built dashboard dist once for the whole host. Per-project traffic rides **explicit paths, never mutable
state**: `/p/<projectId>/api/*` (HTTP and SSE through the same streaming proxy, gzip riding [[public-mode]]'s
transport rule) and the terminal WebSocket (the same replay-and-raw-pipe as the public gateway) resolve
their target from the latest reconciled snapshot per request, where `projectId = encodeProject(root)` —
the store's own key. A project with no live backend answers 502 naming the repair; an unknown one 404s.
Non-API `/p/<projectId>/…` paths serve the SPA shell so a project-scoped URL loads the app. The old
requirement to pair one dashboard with one backend (`--api-port`/API_URL) is gone at this surface;
`spex serve ui` remains the explicit one-backend pairing.

**The durable known-project catalog remembers what records cannot.** Records die with their serve; the
catalog (`~/.spexcode/projects.json`) is the host's memory, populated by explicit registration
(`POST /api/host/projects {root}` — normalized to the repo's main checkout, git-repo required, matching
init's own precondition) and by auto-adoption of any validated live record. Its host operations are
**spawned `spex` verbs, never forked logic**: `/init` and `/doctor` run the real `spex init` /
`spex doctor` as child processes with cwd = the project root (same git/harness/additive guarantees, exit
code + transcript returned), and `/serve` starts an offline project's backend as a **detached**
`spex serve --port <free>` that publishes its own record and outlives the gateway. A malformed catalog
degrades loud-but-alive on read and refuses writes — live backends still list; nothing clobbers the file.

**Backends never depend on the gateway.** Kill the gateway and every serve keeps serving; direct CLI
discovery ([[remote-client]]'s ladder) reads the same records straight from the store, gateway or no
gateway. The gateway obeys the shared port contract (a busy port is a loud non-zero exit via the one bind
helper) and carries the standard connection reaping. Authentication is explicitly NOT this node's
concern: loopback by default, `--host` widens the bind and is announced OPEN — the internet face remains
[[public-mode]].
