---
title: session-origin
status: pending
hue: 145
desc: PENDING design — a session's worktree ORIGIN becomes polymorphic (fresh node branch, or seeded from a PR), so an external PR can be pulled in as an ordinary agent-governed session. One seeding primitive; `spex new --from-pr` the only new surface. No code yet.
related:
  - spec-cli/src/sessions.ts
  - spec-cli/src/layout.ts
---
# session-origin

## raw source

A session today is always born the same way: cut a `node/<id>` branch off the trunk and worktree it. But a
session is really just **an agent governing a worktree** — and the worktree's starting contents are a
construction parameter, not the session's identity. Once you can seed that worktree from *anywhere in
git*, an external branch or pull request (yours, or a collaborator's) becomes an ordinary SpexCode session:
a dedicated agent runs it, reads it, fixes it, and delivers it ([[deliver-port]]) — the thing SpexCode
never had, a way to *receive* outside contributions.

## expanded spec

**Origin is one polymorphic field, seeded once then forgotten.** The session's global record
(`session.json`) gains `origin` (and its source ref); the [[portable-layout]] linker reads it. Two origins to start:

- **fresh** — a new `node/<id>` branch off the trunk. The default; today's behaviour, byte-for-byte.
- **pr** — fetch the pull request's head into the worktree (GitHub `refs/pull/<n>/head`, GitLab
  `refs/merge-requests/<n>/head` — a driver detail, so it routes through [[spec-forge]]'s host-agnostic
  [[port]], never a `if github` in the session code).

Internally there is ONE seed-from-any-ref primitive; the CLI exposes only **`spex new --from-pr <url|#>`**
because that is the real need (collaborate on a PR). `--from-branch` and other origins are a zero-cost
future surfacing of the same primitive, held back on YAGNI until a real need names them.

**A pulled-in session does NOT mint a spec node — and that is not a leak.** The tidy "one session, one
node" reading was wrong: `session ↔ node` is a **contract** relation, not a **production** one. Every
session works *under* a governing spec (it references the nodes whose files it touches); only a delivery
whose destination is the **trunk** requires *authoring* — the fused spec+code commit — because that is the
trunk's own admission gate ([[main-guard]] / [[spec-lint]] sit on the gate, not on the session). So there
is **one kind of session** with the gate at the landing place, never two species (spec-native vs foreign).
A `from-pr` session references the governing nodes of the files its PR touches and delivers a **verdict**
by default ([[deliver-port]]); it authors a node only if a maintainer retargets it to the trunk.

This also names an accident already in the tree: a session whose branch was a raw forge URL had to make
the node id **double as the origin** (the URL stood in as the node name), which is why its `spex ls` label
read as a URL. With origin a first-class session-record field, the node id goes back to being purely a
[[source-of-truth|spec-tree name]] — the neighbouring scenario the fix also explains.
