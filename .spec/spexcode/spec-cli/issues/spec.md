---
title: issues
status: active
hue: 30
desc: One Issue object over every store — a concern bound to nodes, with its own lifecycle. Local-store threads and forge issues are the same type behind a per-issue storage adapter; one merged read port serves the CLI, the API, and the board (eval-remark threads split out — they are the eval scoreboard's, not issues).
code:
  - spec-cli/src/issues.ts
---
# issues

## raw source

A thread in the local issue store and an issue on a forge are **literally the same object on the proper
abstract level** — a recorded concern bound to spec node(s), carrying its own lifecycle, living *beside*
the graph and never *as* node state. Local and remote issues are the SAME data model under the SAME name —
an issue; a store where either needs a different model or a different word is a bug. Where one is stored is a property of the individual issue, not a
mode of the project: a project has **both at once, mixed** — an agent's taste concern living local next
to a human-visible GitHub issue, on the same nodes. Don't build two parallel systems and promise a
bridge; build the one object and let the stores be adapters.

## expanded spec

**The core type.** An `Issue` is `{ id, store, concern, by, status, nodes[], signers[], created,
body, replies[], evidence[], url? }`. `store` names the adapter that holds it (`local`, or a forge host
like `github`) — data, not a mode. There is deliberately **no content-kind taxonomy**: a field that does
no mechanical work (nothing branches on it) is a label, not structure — what a thread *is* (a change
suggestion, an annotation, a question) is what its prose says.
`nodes[]` is the binding to the graph; `status` is the issue's OWN lifecycle,
authored in its store, never git-derived (a node *defines*, an issue *does* — [[spec-forge]]'s two-plane
contract holds here unchanged). `evidence[]` is a list of yatsu content-addressed blob hashes — the typed
target [[video-evidence]] points at when a video finding routes to the responsible node's concern. A reply
may itself be a **remark** ([[remark-substrate]]) — the same `{by, at, body}` shape plus a mutable
`resolved` bit and the reading it was authored against — but that is one reply carrying extra state, not a
second thread type; a plain reply is unchanged.

**Two stores, one translation rule.** The **local** store is the local issue store ([[local-issues]] owns its whole
mechanism — venue, file format, lock, trunk commit); a local issue thread *is* a local Issue, its `store` implied
by where it lives, never written into the file. The **forge** store rides [[spec-forge]]'s tracer read:
a `ForgeIssue` becomes an Issue at this boundary — id `<host>#<number>`, title → concern, state → status,
its comments → `replies[]` (the SAME Reply shape a local issue thread carries — both stores' discussions are one
thread type, so every surface renders one kind of thread), and the host's node-naming conventions (`Spec:`
body marker, transitive PR links — [[links]]) translated into `nodes[]` **here**, so product semantics see
only `nodes[]` and never know a marker existed. Platform differences live at the adapter boundary; nothing
downstream branches on store.

**One read, differently freshened — and ONE time line.** `mergedIssues(forgeState, nodeIds)` is a pure
merge that interleaves every store by creation time, **newest first** — the stores are the same
abstraction, so a github issue, a gitlab issue, and a local thread sort as one list, never
store-grouped blocks (that grouping is exactly the two-surfaces smell this node exists to kill). It
**excludes eval-remark threads** (`isEvalConcern`, [[eval-issue-split]]): a scenario-scoped concern is a
remark, not an issue (I1), so it is filtered here ONCE and every issue surface this feeds — the drain, the
board badge, the [[issues-view]] Issues page list — is free of it by construction; the complementary read
`loadEvalRemarkTracks` keeps only those, feeding the eval scoreboard instead. Each
caller supplies the forge slice at the freshness its surface warrants — the server ([[dashboard-issues]]'s
resident cache: instant view, background reconcile) for `GET /api/issues` and the board fold, the CLI
(`spex issues [--node] [--store] [--all] [--json]`) via a live driver pull that **degrades loudly
to local-only** (one stderr note) when the forge is unreachable — local reading never hostages on a
network. The board fold attaches each node's merged issues (`issues` / open subset `openIssues`), so every
per-node surface — tile badge, focus panel, node-info Issues tab, the [[issues-view]] page — reads the
same mixed set with no second path.

**Writes stay where they're owned — and the reply verb routes by store.** Opening, signing, and resolving
(`spex issues open` / `sign` / `resolve`, and the dashboard's New) stay local-store writes. **Replying is ONE
verb over both stores** (`replyIssue` — `spex issues reply <id>` and `POST /api/issues/:id/reply` are the
same routing): a local id goes through the local issue store's committed write, a forge id (`<host>#<n>`) posts a
**real comment** through the driver's `createComment` — the [[port]]'s second write verb, the same seam
discipline as promotion (the driver stays the only network toucher; the tracer stays read-only; a failed
forge write fails loud, never queues). A local reply may carry optional `evidence` hashes (an anchored
annotation's frame blob) that accrue onto the thread's typed `evidence[]`, deduped — a forge reply has no
such field, so its frame rides the comment body's image link instead. Either way the reply **text**'s `@`-mentions dispatch afterward
([[mentions]] fires on the words, store-agnostic) — mentioning `@new`/`@session` in any thread IS the
"assign this issue to an agent" verb; no separate assign machinery exists. Beside that explicit dispatch, the
same reply also loops in the thread's **originator** as a courtesy if their session is online (the implicit
loop-in — [[mentions]] owns the mechanism, silent when offline, never a spawn); the originator is a local
thread's author, or an eval-comment thread's reading-filer, and a forge issue's github-login author resolves
to nobody, so a forge reply loops in no one. Freshness after a forge write
stays caller-owned: the server forces its resident slice's read-back before answering (the comment shown
is the read-back, never a local echo); the CLI's next read is a live pull anyway.
The one cross-store verb is **promotion** —
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
