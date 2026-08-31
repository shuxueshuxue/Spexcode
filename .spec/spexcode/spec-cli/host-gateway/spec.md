---
title: host-gateway
hue: 180
desc: One `spex dashboard` for every project a user serves — instance-validated endpoint records reconciled into a live project list, proxied per project via /p/:projectId/*.
code:
  - spec-cli/src/host.ts
related:
  - spec-cli/src/endpoint-record.ts
  - spec-cli/src/supervise.ts
  - spec-cli/src/gateway-hub.ts
  - spec-cli/src/gateway.ts
  - spec-cli/src/machine-peer.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/help.ts
  - spec-cli/src/index.ts
  - packages/spec-core/src/layout.ts
  - spec-cli/src/host.test.ts
---
# host-gateway

The bar: **a user who runs several SpexCode projects on one machine opens ONE dashboard and reaches all
of them — no `--api-port` pairing, no per-project UI process, no "current project" toggle.** Each
backend stays exactly what it is — one `spex serve` per repo, loopback-only, auth-unaware, ignorant of
every other project; the HOST level is where multiplicity lives.

**The seam between the two levels is the endpoint record.** After its public bind succeeds, a serve
ATOMICALLY publishes `{version, url, pid, instanceId, root, identity, startedAt}`
into the per-user global project store and, on a clean stop, removes only a record that
still carries its own `instanceId` — never a newer serve's, never another project's. The `instanceId` is
minted once per serve lifetime and handed to every child through env, so the identity is stable across
zero-downtime reloads; the child answers it (with the root it serves) at `GET /api/instance`. A record
is therefore *checkable*, not just present: the reader compares instance and actual served root against the
live answer, and only a full match counts as online. A linked-worktree serve registers under its own git
toplevel and cannot replace the main checkout's slot. A crashed serve, a
recycled port now serving something else, or a record copied into the wrong store slot (the slot must
equal `encodeProject(root)`) all fail the match and degrade to "offline project" — never a proxy to the
wrong backend.

**`spex dashboard` is [[gateway-hub]] plus the host registry — one gateway, one seam, nothing duplicated.**
The hub owns routing, `/p/:projectId/*` proxying (HTTP/SSE/WS, prefix-stripped, gateway cookies
stripped), and every authorization decision ([[gateway-auth]]: admin scope implicit from
loopback until an admin password exists; per-project gates as configured). This node mounts the host level
onto the hub's extension seam: `GET /projects` rows become the **reconciled** list — every cataloged or
record-claimed project with its instance-validated `online` state, not just the live records — each
carrying the hub's gating flag and [[identity-config]] projection; `GET /projects/stream`
is that list as a live SSE; and paths the hub doesn't own serve the built dashboard dist once for the
whole host. Per-request routing truth stays the hub's: a record is routable only in the identity shape,
only in the store slot its own root encodes to, and only to a loopback url — the shared record-read seam
(`readEndpointRecord`), not a second registry. A project with no record answers 404 before any upstream contact. No
`--api-port`/API_URL pairing survives at this surface; `spex serve ui` remains the explicit pairing.

**The durable known-project catalog remembers only deliberate choices.** Records die with their serve; the
catalog (`~/.spexcode/projects.json`) is the host's memory, populated only by explicit registration. A
record-claimed project remains visible while its record exists, so a live ad-hoc worktree is still
reachable and diagnosable, but stopping it never turns an experiment into a permanent offline menu entry.
The reconciled view includes a remembered or record-claimed root only while that root is still an existing
directory; a removed checkout/worktree disappears from `GET /projects` without mutating the catalog file.
Explicit registration is one admin-scoped workflow over
the real host filesystem: a read-only directory browser selects an existing folder or reports a typed absent
path as a candidate, then `POST /projects` normalizes it to the repo's main checkout. An existing Git repo
can be cataloged directly; a plain folder enters only after the user explicitly chooses the bounded `git init`
side effect. An absent candidate enters only through the explicit `createDir` + Git-initialization transaction,
which creates the requested path before that same Git/catalog workflow. The add transaction establishes a
branchable source-of-truth before it writes the catalog: a repository it initializes gets an initial commit
on the conventional `main` branch, while an existing repository with an unborn `HEAD` gets an initial
commit on its current branch. If an interrupted adoption already left `.spec` or `spexcode.json` on disk,
that SpexCode source is recovered into the same commit; only a repository with no seed at all receives an
empty commit. A newly created path also runs the real `spex init --harness none` when no
explicit SpexCode setup was requested, so the project is immediately usable by the session launcher picker
and its later Harness-target `+` action. Optional SpexCode setup still runs the real `spex init` with an
explicit harness choice, never a dashboard-owned initializer; after it succeeds, the transaction commits
only the SpexCode seed (`.spec`, portable `spexcode.json`, and its ignore policy) with a tool-owned identity.
No user source path is staged by this baseline commit. A failed init or baseline commit returns its exit code
and complete transcript and does not claim catalog success; the catalog write happens only after every
requested setup step succeeds. Its project operations ride the same hub admin scope. `GET|PUT /projects/:id/config` is
the narrow source-file seam for the project's raw,
committed `spexcode.json`: it works while the backend is offline, treats an absent file as `{}`, accepts
only a top-level JSON object, writes atomically, and rejects a stale revision rather than overwriting a
concurrent edit. It never exposes `spexcode.local.json`, whose machine-specific layer may carry sensitive
paths. Sibling structured icon routes revision-check and update only the canonical project or host field;
they never create another setting. Operations remain **spawned `spex` verbs, never forked logic**. A source
host module invokes its source entry through the repository's development loader; a compiled or installed host
invokes the matching `dist` entry through Node, so host children never make an installed user acquire the build
chain:
`/projects/:id/init` and `/doctor`
run the real `spex init` / `spex doctor` with cwd = the project root (same git/harness/additive
guarantees, exit code + transcript returned), and `/projects/:id/serve` starts an offline project's
backend as a **detached** `spex serve` that publishes its own record and outlives the gateway. A
malformed catalog degrades loud-but-alive on read and refuses writes — nothing clobbers the file.

The admin surface also exposes `POST /projects/:id/harnesses` for an already registered project. Its body
contains one native harness id or one explicit `{"plugin":"<folder>"}` target plus the current config
revision. The host extends the persisted `harnesses` array only after validating the existing and next set
with [[harness-select]]: native and plugin targets are mutually exclusive, and a missing or malformed
`harnesses` field fails loud instead of inventing a selection. The write is atomic and revision-guarded,
then runs the real `spex materialize` in the project root. A native target may receive a launcher copied from
the safe init template; a target without such a template (currently `zcode`) is still delivered without a
fabricated command. The response carries the resulting source, revision, targets, and materialize exit code
and transcript, including when materialize fails so the caller can retry the persisted choice. This route is
admin-scoped like the other project management operations.

**Registration removal is not checkout deletion.** `DELETE /projects/:id` is a deliberately high-friction
catalog lifecycle operation. It accepts an exact `REMOVE <resolved project title>` confirmation, refuses
while the instance-validated backend is online or while any project session record is active/unreadable,
then removes the catalog entry, clears that project's gateway password, and removes only a runtime endpoint
record whose process is proven gone. It never recursively deletes the project directory, `.git`, source,
or SpexCode files. A missing project answers 404; a refusal names the blocking backend/session condition.

**Backends never depend on the gateway.** Kill the gateway and every serve keeps serving; direct CLI
discovery ([[remote-client]]'s ladder) reads the same records straight from the store, gateway or no
gateway. The gateway obeys the shared port contract (a busy port is a loud non-zero exit via the one bind
helper) and carries the standard connection reaping — both via the hub. Authentication is deliberately NOT
this node's mechanism: it is [[gateway-auth]]'s, decided once at the hub — this node adds no second gate,
no second cookie, no bypass. Transport is likewise the hub's: `startHostDashboard` accepts the hub's `tls`
option and hands it through unchanged, so an operator deployment runs the ONE host gateway directly over
HTTPS — every surface (admin list, /p proxying, the shell) on that one TLS port, no second proxy in front,
and a plaintext client on the TLS port is refused, never silently downgraded. Absent `tls`, `spex
dashboard` stays plain loopback HTTP; `--host` widens the bind, behind whatever gates the operator
configured.

[[machine-peer]] is a second, private lifetime owned by this same host process. The gateway owns each
machine-peer SSH process and the pair of loopback-only peer ports it forwards; the dashboard shell is not a
participant in an individual message. A local CLI may dial the outgoing peer port directly, while the remote
gateway owns the incoming peer port and forwards the accepted envelope into its ordinary local project
backend. This keeps the public `/p/:projectId/*` proxy and backend contract unchanged, while making the
gateway — not a session, project, or one-shot CLI child — the owner of a durable machine link.
