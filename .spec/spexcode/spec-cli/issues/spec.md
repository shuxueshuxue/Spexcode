---
title: issues
status: active
hue: 30
desc: One Issue object over every store — a concern bound to nodes, with its own lifecycle. Local forum threads and forge issues are the same type behind a per-issue storage adapter; one merged read port serves the CLI, the API, and the board, and one reply verb routes each write to the store that holds the thread.
code:
  - spec-cli/src/issues.ts
---
# issues

## raw source

A proposal in the git forum and an issue on a forge are **literally the same object on the proper
abstract level** — a recorded concern bound to spec node(s), carrying its own lifecycle, living *beside*
the graph and never *as* node state. Where one is stored is a property of the individual issue, not a
mode of the project: a project has **both at once, mixed** — an agent's taste concern living local next
to a human-visible GitHub issue, on the same nodes. Don't build two parallel systems and promise a
bridge; build the one object and let the stores be adapters.

## expanded spec

**The core type.** An `Issue` is `{ id, store, concern, by, status, nodes[], signers[], created,
body, replies[], evidence[], url? }`. `store` names the adapter that holds it (`local`, or a forge host
like `github`) — data, not a mode. There is deliberately **no content-kind taxonomy**: a field that does
no mechanical work (nothing branches on it) is a label, not structure — what a thread *is* (a change
proposal, an annotation, a question) is what its prose says.
`nodes[]` is the binding to the graph; `status` is the issue's OWN lifecycle,
authored in its store, never git-derived (a node *defines*, an issue *does* — [[spec-forge]]'s two-plane
contract holds here unchanged). `evidence[]` is a list of yatsu content-addressed blob hashes — the typed
target [[video-evidence]] points at when a video finding routes to the responsible node's concern.

**Two stores, one translation rule.** The **local** store is the forum ([[proposals]] owns its whole
mechanism — venue, file format, lock, trunk commit); a forum thread *is* a local Issue, its `store` implied
by where it lives, never written into the file. The **forge** store is [[spec-forge]]'s read-only tracer:
a `ForgeIssue` becomes an Issue at this boundary — id `<host>#<number>`, title → concern, state → status,
the issue's comment thread → `replies[]` (the SAME `{by, at, body}` shape a forum reply has, so both
stores' threads render through one path), and the host's node-naming conventions (`Spec:` body marker,
transitive PR links — [[links]]) translated into `nodes[]` **here**, so product semantics see only
`nodes[]` and never know a marker existed. Platform differences live at the adapter boundary; nothing
downstream branches on store.

**One read, differently freshened.** `mergedIssues(forgeState, nodeIds)` is a pure merge; each caller
supplies the forge slice at the freshness its surface warrants — the server ([[dashboard-issues]]'s
resident cache: instant view, background reconcile) for `GET /api/issues` and the board fold, the CLI
(`spex issues [--node] [--store] [--all] [--json]`) via a live driver pull that **degrades loudly
to local-only** (one stderr note) when the forge is unreachable — local reading never hostages on a
network. The board fold attaches each node's merged issues (`issues` / open subset `openIssues`), so every
per-node surface — tile badge, focus panel, node-info Issues tab, the [[issues-view]] page — reads the
same mixed set with no second path.

**Writes route to the store that holds the thread.** A reply is one verb over both stores —
`replyIssue(id, body, author)`, the single path behind `POST /api/issues/:id/reply`: a local id goes
through the forum's own write ([[proposals]], unchanged); a forge id posts a **real comment** through the
driver's `createComment` (the [[port]]'s second write verb — the driver stays the only network toucher,
the tracer stays read-only), then folds that issue's fresh thread into the resident cache so the reply
shows where it landed without waiting out the TTL. An unreachable forge fails **loud** — the write is
never faked locally. Either way the reply TEXT is dispatched for @-mentions ([[mentions]] fires on the
text, never the store), so summoning an agent — `@session`, `@new` — works identically from a forum
thread and a GitHub issue: the mention IS the assignment, no separate assign machinery. New threads
(`spex propose`, the dashboard's New) still start local, and `sign` / `resolve` remain local-store verbs —
a forge issue's lifecycle is authored on the forge. The one cross-store verb is **promotion** —
`spex issues promote <id>`: a local concern that outgrows the repo (needs CI or external visibility) moves
to the forge as one recorded action instead of a lossy hand-copy. It composes the forge issue from the
thread itself — concern → title; body + the `Spec: <nodes>` marker + the evidence hashes + a provenance
footer — and creates it through the [[port]]'s driver (the driver stays the only thing that touches the
network; no second `gh` call-site). The marker is the round-trip: the promoted issue links back to the
same nodes through the EXISTING tracer read, so promotion adds no linking code. Order makes failure safe:
the forge issue is created FIRST, and only then is the local thread closed out — resolved `landed` with a
reply carrying the permalink (its file remains as the recorded trail); an unreachable forge fails loud
with the local thread untouched, and only an `open` thread promotes. The two-plane contract is untouched
throughout: a forge issue is execution, never node state.
