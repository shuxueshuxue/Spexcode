---
title: graph-stream
status: active
hue: 190
desc: The graph's push channel — an SSE with two modes (bare change signals, or hash-chained incremental patches) fed by domain-scoped freshness sources, self-healed by an accountable patrol.
code:
  - spec-cli/src/graphStream.ts
related:
  - spec-cli/src/graphStream.test.ts
  - spec-cli/src/graphStream.api.test.ts
---

# graph-stream

## raw source

The dashboard kept its status/grouping fresh by re-fetching the whole graph on a 4s timer, while the live
terminal rode a WebSocket. So a session's status change felt laggy (up to the poll interval) even though the
backend already knew it — two different freshness models on one screen. Give the graph the terminal's model:
the backend pushes and the dashboard follows, so status flips as fast as the characters do. Then the probe
campaign measured the push itself: a one-field lifecycle write cost a flat 150ms wait plus a full ~250ms
graph rebuild before its 1KB patch went out. The signal must carry its DOMAIN, so a session change pays a
sessions-only splice — and every leaf that can be watched IS watched, so the patrol stops being load-bearing.
Then an adopter at 53 live worktrees showed the other half of that bill: watching a leaf is not free, and a
registration scheme that multiplies per spec file buys blindness rather than freshness.

## expanded spec

graph-stream is the graph's live-delivery channel: `GET /api/graph/stream`, a server-sent-events stream a
dashboard opens once, server→client only. It speaks two protocols on one route. **Plain mode** (no query) is
the legacy contract, kept verbatim for old clients: a bare `graph-changed` signal, the client refetches
`/api/graph` on its ETag/304 path. **Delta mode** (`?mode=delta`) inverts who fetches: the server sends a
full snapshot on every (re)connect (`graph-full {to, graph}`), then per change either the hash-chained patch
(`graph-delta {from, to, set, del}`) or a fresh full when the patch wouldn't win — the algebra, and the
proof that this renders exactly what refetching would, is [[graph-delta]]'s contract. The cached anchor
snapshot a connecting subscriber is seeded with lives exactly as long as its subscriber era: with zero
delta subscribers nothing rebuilds on change, so the anchor dies with the era's last unsub (and a build
that completes after it caches nothing) — a new era's first frame is a fresh build, never a kept frame
from before the gap, whose missing sessions would empty the client's warm-terminal panes (issue #70).

**Every change signal carries its domain.** `fireChanged(scope)` — 'sessions' or 'full' — feeds
[[graph-cache]]'s scoped invalidation, so a session-only change is answered by the sessions SPLICE (fresh
`listSessions`, every other unit reused) instead of a full assembly: measured, the store-write→push path
dropped from ~420ms median to ~56ms on the dogfood corpus. The sources and their scopes: (1) recursive
filesystem observation on the per-user session store ([[runtime]]) → 'sessions'. (2) the git dir's refs
(loose refs recursively, `packed-refs`/`HEAD`) → 'full' — a commit legitimately reshapes nodes, drift, overlays and
eval anchors at once, which is why refs stay full-scope rather than pretending to a narrower domain. (3)
TWO subscriber-gated pollers for what never touches a file ([[state]]): a ~100ms HOT tier (`hotSignature`
— pure-syscall death detection over launch-registered pids) and a ~1s WARM tier (`warmSignature` — one
merged tmux call for window/title state plus the rendezvous tri-state), both → 'sessions'. (4) the
`.git/worktrees` REGISTRY watcher — git's own birth-ledger for every worktree, hand-made or dispatched —
which attaches one whole-tree observation of each live worktree's root plus one non-recursive gitdir watch,
and detaches both on removal. Root events cover dirty governed source, renames, draft scenario declarations and reading
sidecars; the gitdir watch covers `index` changes from stage/reset that do not rewrite the working file. Both
fire 'full'. Only `.git` transport metadata (covered by its own watchers) and `node_modules` dependency bytes
are ignored; generated project paths are not guessed away, because an adopter may govern them. A
pathless/overflow-like event or watcher error is treated as an unknown full change, never ignored. For the eval
projection specifically, losing either the refs observer or a worktree observer places a keyed hold before the
graph rebuild: the affected summary remains updating with last-known and cannot compute current while the source
is absent. Worktree resubscription retries with bounded backoff while the hold remains; the successful attempt
installs its replacement first, removes only that source's hold, then advances and performs an authoritative
rebuild. A persistent failure remains held and every retry remains only an observer repair — it never certifies
data or substitutes a periodic fingerprint build. And (0) the exported explicit nudge (`notifyBoardChanged`) for
a server-side mutation that must show regardless of watcher health — `/rename` passes 'sessions', and the
issue/remark write routes pass 'full' **atomically with their store persist** ([[remark-substrate]]
write-visibility: the writer's own post-write refetch must never race an asynchronous fs event into the
stale cache; the issue store dir is deliberately not a watched leaf — one mechanism per surface). All
funnel into one debounced fire; the debounce is **25ms**, sized to the MEASURED fs-event burst width
(0–5ms for real declares/renames, single-digit ms for ref moves) — the in-flight build's dirty-rerun loop
is the coalescer for anything wider, so the old flat 150ms was pure added latency.

**One registry owns filesystem observation, and its cardinality follows the canonical roots.** Every source
is one reusable `(root, scope)` registry which is the sole owner of every handle taken for it. What this
module registers is the set of roots the graph actually has to observe: the session store, the git common
dir's `refs` and its metadata files, the worktree registry, and — per LIVE worktree — its working tree plus
git's metadata dir for it. That count grows with roots and worktrees and with nothing else; 444 spec nodes
inside a worktree are the same one registration as an empty one. Registration that instead multiplied per
spec file is precisely what took an adopter down: 53 live worktrees × 444 node directories asked the
platform for 23,532 registrations.

**The transport is where the platform may differ, and the only place it may.** Observing a tree is ONE
registration to this module; how many the OS holds underneath is the transport's business, and the two
transports satisfy one contract — idempotent refresh, atomic reclaim, root-relative delivery, exclusion,
loud failure:

- Where the OS observes a whole subtree from a single registration (Darwin's FSEvents, Windows'
  `ReadDirectoryChangesW`), a root registers exactly once and the kernel covers the rest. It reports by
  PATH, so atomic replacement inside the tree stays visible and no rename can make the desired set drift —
  there is nothing to re-walk. Exclusions filter on delivery, because nothing was consumed per directory to
  exclude at registration.
- Where it does not (Linux), Node's `recursive` option is a USERSPACE fan-out: measured, 201 directories
  became 801 inotify watches — one per file as well as per directory — and a file watched by inode goes
  blind the moment it is atomically replaced, after which a later commit could move a ref with no event and
  no registration error. So that transport enumerates directories once and installs one **non-recursive**
  watch each, all multiplexed onto the event loop's single shared inotify descriptor, excluding worktree
  `.git` transport metadata and `node_modules` at traversal time. A rename schedules one refresh of the
  desired set; refresh is a set reconciliation, so an unchanged path is never registered twice, a
  disappeared path's handle is closed, and a new path is installed exactly once. Atomic replacement stays
  visible through the containing directory's stable handle.

Which transport a platform gets is a capability question, never a corpus one: no adopter, worktree count or
repository is special-cased anywhere.

**Refusal is fatal, silent and process-wide — which is why the budget is not negotiable.** Asking a
consolidated platform for per-directory registrations does not merely waste them: at 8,920 registrations
macOS answered `EMFILE` on every single one, with the process holding twelve descriptors and its soft limit
at 1,048,575 — the ceiling is the platform's own registration budget, not a descriptor table, and no
`ulimit` raise addresses it. Because that event source is process-wide, one over-budget root takes every
other source down with it: the same run held 3.0 GiB resident with no git child alive while every watcher
had already gone deaf and delivered nothing. The identical corpus at one registration per root attaches in
3 ms and holds 53 registrations. The live census — how many roots were asked for, how many registrations
the platform is holding for them — is observable, so a plateau is a fact on every platform rather than only
where `/proc` exposes inotify descriptors.

**An exhausted source is one loud failure and one bounded repair, never a storm.** A registry that cannot
attach closes every handle it had already taken BEFORE it reports, so no half-attached set and no leaked
handle survives a partial failure. The report names the source, the path and the errno, and is loud once
per episode — the sources felled by the same process-wide budget are counted, not re-printed. The failed
source is then HELD: an ordinary graph build, an HTTP read, a poller tick or a registry event may not
re-attempt it, because a refused registration re-tried by whatever noticed it is exactly how one failure
became a per-read re-walk of every worktree. Reattachment belongs to ONE repair schedule with exponential
backoff, shared across sources because the exhausted resource is shared; it states how many sources it
holds and when it will try again. A source that comes back clears its own hold, and an episode with nothing
left held resets the backoff. While a source is held its eval projection stays observer-held and visibly
non-current, and the changes it would have seen are found by the cold-tick patrol and reported as the
repairs they are. Coverage degrades to the patrol's cadence; it never degrades to silence.

Registry ownership follows the source lifetime, not a graph build. Repeated `/api/graph`, invalidation, and
scoped Eval reads reuse the same `(root, scope)` registry. A worktree path changing under one git registry
entry closes the old root and index handles before installing the replacement; worktree removal closes both.
Changing the resolved session-store/git root closes every registry from the old source set, and an explicit
`closeBoardFileWatchers()` drains all file handles, holds and the pending repair timer when the backend
child/server ends, while a later ensure can open a clean era. Source failure does not crash the HTTP
server, but it is never silent. Successful replacement is live before its hold is released and its
authoritative rescan is triggered.

**The patrol is a self-heal authority, not a crutch — and it is accountable.** The delta-gated ~15s cold
tick asks [[graph-cache]] for a patrol refresh and tags that refresh `patrol`; it does not mark the board
full-dirty merely because time passed. The cache compares its compact board-input revision under the same
single flight as a real rebuild. An unchanged tick returns the anchor and starts zero assembly, while a moved
revision selects the cache's existing session-splice or full-build domain (so an uncommitted worktree edit or
ref move a leaf missed still lands). A resulting diff when NO leaf watcher signalled logs a loud
`PATROL-REPAIR` naming the changed units: a repair means some leaf is blind, and the target state is
repairs/hour = 0. The trigger set is what
caused ONE refresh, so the refresh consumes it whether or not content moved — a no-op patrol must not leave its
tag behind to make the next genuine repair read as leaf-signalled, which is the alarm silencing itself on
exactly the machines that need it. `SPEXCODE_DISABLE_WATCHERS` (csv: store, refs, worktrees) deliberately blinds
a leaf so tests can prove the patrol catches and reports what it misses; `SPEXCODE_BOARD_DEBUG=1` logs every
broadcast's changed units, trigger tags and refresh cost. No second timer, fingerprint poller, or eval-summary
generation exists: the one cold tick verifies ordinary board inputs, while session-eval currentness remains
event-driven under [[session-eval]]'s observer holds.

The patrol is deliberately **not an eval-summary correctness source** ([[session-eval]]). It neither advances a
session eval input generation nor starts a periodic fingerprint/build. Session-eval coherence is a state machine
over canonical events: a relevant refs/worktree/explicit-write event first increments the affected cache
generation and makes the session unit `updating(lastKnown)`, then the existing graph debounce ships that state;
the stable latest-generation result later replaces it through this same envelope. A burst increments through its
events but may publish/build only the newest generation. No summary-specific SSE, WebSocket, endpoint poll, or
timer exists.

**Rebuilds are gated on someone listening.** With no delta subscriber the pipeline never builds — plain
subscribers get the zero-cost notify, a closed dashboard costs nothing (both pollers stop with their last
subscriber). With delta subscribers the debounced fire rebuilds ONCE through [[graph-cache]]'s single-flight
`getBoard()` (the SSE rebuild and a concurrent `/api/graph` poll share one assembly), broadcasts the patch,
and notifies plain streams only when the content tag actually moved. A failed source keeps the server serving
but fails loudly, closes its partial registry, and retries under its observer hold. The patrol can still repair
ordinary graph units and reports that repair; an eval input source that cannot start instead leaves its
projection observer-held and visibly non-current until the source is restored.

**Reconnect is free, and the ping is a contract.** A backend hot-reload drops the stream; `EventSource`
auto-reconnects and the fresh `graph-full` re-anchors the patch chain with no client-side repair logic. The
keep-alive `ping` (which also keeps idle proxies from timing the stream out) is promised every **10s** and
is only transport liveness, never data freshness. [[dashboard-shell]] holds the server to it — silence past 2.5 windows means a
DEAD stream to replace (the half-open deaths that fire no error event), so an undetectably dead connection
marks session summaries last-known and reopens the stream; only the reconnect's authoritative `graph-full`
certifies them current again. An old backend without this route,
a proxy that strips SSE, or a server that ignores `?mode=delta` still degrade to the plain protocol or the
poll — never to a frozen view. The full snapshot itself (first paint, resync) stays [[graph-lean]]'s cut
(issue #26), composing with — not replaced by — the delta path.
