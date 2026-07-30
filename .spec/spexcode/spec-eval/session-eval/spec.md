---
title: session-eval
hue: 150
desc: A session's fully-derived evaluation — the worktree-rooted engine (sessioneval.ts) whose interactive face is now the Evals route family scoped by the `scope:<id>` query token ([[evals-view]] — the console and phone expose real-anchor navigation doors, never a local Eval tab), its CLI twin `spex eval ls --session <SEL>`, and the self-contained HTML as an EXPORT artifact (`--export`). No agent authoring.
code:
  - spec-eval/src/sessioneval.ts
related:
  - spec-cli/src/index.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/client.ts
  - spec-cli/src/eval-cli-read.test.ts
  - spec-dashboard/src/SessionInterface.jsx
  - spec-eval/src/sessioneval.test.ts
  - spec-eval/src/sessionimpact.api.test.ts
  - spec-dashboard/src/EvalsPage.jsx
  - spec-dashboard/test/session-scope-impact.e2e.mjs
  - spec-dashboard/src/sessionEvalCoherence.test.mjs
---
# session-eval

## raw source

A human deciding whether to merge — or just wanting to see what a session has done so far — shouldn't have to
hand-read the diff and hunt the evidence. Give them one **proof of work** — the session's measured eval readings
evidence, its diff, and the merge gates, in a single beautiful page, available for **any** session (it comes
into its own at review, but the human can open it any time). It is **fully DERIVED**: it costs the agent nothing
and can never go stale, because it is built from what the system already knows and **generated on the fly
each time it is opened**. This is the optimizer's measured loss, marshaled at the moment a human decides.
And it is not a separate world: the human's directive re-homed un-merged worktree evals into the ONE Evals
route family — a session's evaluation is the same pages as the project's, scoped.

## expanded spec

**One engine, thin faces** (the [[eval-history]] / `buildBoard` pattern). The engine is `sessioneval.ts` in
[[spec-eval]] — the marshaled *evaluation* lives with the evaluation package and is the
one place the eval engine reaches into the review state ([[manager-cockpit]]'s `reviewPayload`). It runs ONLY on the
backend: `buildExportModel(id)` joins the payload's diff (grouped per spec node) with each affected scenario's
[[eval-tab]] timeline (latest reading per scenario — verdict, expected, the content-addressed
evidence) and the gates; `renderExportHtml(model)` emits ONE self-contained HTML document, evidence inlined
as data-URIs ([[eval-core]]'s cache) so it stands alone as a plain file. The whole model is rooted at the
**session's worktree** — the eval timelines (freshness and readings reflect that branch, not the backend's
checkout) AND the **spec tree itself** (`loadSpecs` at the worktree root): a node the branch **added** is a
first-class changed node here — present with its declared scenarios and filed readings while the branch is
still un-merged — because the worktree's `.spec` is the branch's pending proposal ([[source-of-truth]]),
not invisible. A session with no worktree reads the backend checkout unchanged. The
headline is DERIVED (the node, else the branch) — there is no agent-authored claim, manifest, or narrative.
A frontend node with no eval.md shows as an honest blind spot, never hidden.

**The session scope is scenario-shaped, not node-shaped.** Three independent axes feed the model and never
stand in for one another. **Declared** comes from the current worktree's eval.md. **Affected** is derived
against the session merge-base: a scenario enters when its own `code` axis (else its node's inherited `code:`
axis) intersects the worktree diff, when that scenario's semantic contract (description + expected, the SAME
`scenarioHash` projection [[eval-core]] uses) changed, or when this session actually filed a reading for it.
**Fresh** remains the live [[eval-core]] judgment on the latest reading after the scenario has entered scope.
The impact predicate lives once in `sessioneval.ts`; every session face consumes the already-scoped model.
Touching a node's spec.md, eval.md, or one sibling scenario therefore never sweeps the eval.md's other scenarios
into the session. Contract comparison follows an eval.md rename/reparent back to its merge-base path, so a pure
move changes no scenario; the measurement axis reads the live worktree sidecar, so a reading this session just
filed is visible before its eventual evidence commit even when the session changed no code. An affected scenario
stays visible whether its latest reading is fresh, stale, legacy, or
missing: stale and missing are review work, not reasons to hide it. A declared affected scenario with no
effective reading is the precise **blind/unmeasured** case (the contract is known, the measurement is absent).
A changed frontend node with no eval.md is **unknown coverage** (there is no declared contract to count as a
scenario) and remains called out separately; it never inflates the scenario accounting or the list's scenario
filter counts. The session toolbar renders that accounting once, as its mutually exclusive categories: fresh
pass, fresh fail, measured-but-stale/unscored work needing review, and blind declarations add back to the
affected total; unknown remains outside it. It does not repeat a measured/declared fraction beside that complete
decomposition.

That predicate is also a **public exact-revision impact projection**, not a session-UI heuristic. Given a
repository plus base/head selectors, it resolves both selectors once, pins every declaration and diff read to
those object ids, then verifies that the selectors still resolve to the same ids before publishing. Its output
carries the resolved `base`, `head`, a content `revision`, each node's review causes, and every scenario delta:
`code|contract|measurement` impact reasons, selector-hit commits/symbols, base/head `scenarioHash`, and separate
semantic versus metadata movement. A scenario rename is one removed declaration plus one added declaration;
description/expected movement is semantic and moves the hash, while test/code/related/tags are metadata and do
not. A scenario's effective code is its own `code` relation when present, otherwise the node's complete
`code` relation including selectors. Node/scenario `related` movement remains node review context only and
never spreads impact to every scenario.

The range contract is ancestry, not an arbitrary two-tree comparison: `base` must be an ancestor of `head`,
normally the session merge-base and its exact HEAD. A divergent pair is explicitly unavailable; the engine
never substitutes another merge-base behind the caller's back. A live session adds one immutable worktree
overlay captured under the existing content-revision double read. That overlay includes staged, unstaged,
renamed, deleted, and untracked paths, exact old/new hunk ranges and bytes, plus the complete worktree spec/eval
declarations, so dirty semantic/metadata edits and branch-new nodes are first-class impact input rather than a
reason to disable the face. Snapshot or Git transport failure is unavailable; ordinary dirty work is not.

Selector-aware code impact reuses [[eval-core]]'s `scenarioCodeAxis` and [[code-anchor]]'s ONE
parse -> extractor -> resolve -> revision-hunk/range intersection engine. A changed shared file therefore
selects only the scenario whose named unit was hit; no impact-local parser, extractor registry, or path matcher
exists. Removed declarations resolve and intersect on base; added declarations do so on head. A structurally
invalid, dead, ambiguous, unavailable, or unextractable selector makes the projection explicitly unavailable
with the selector and repair named, even when the changed-path set is empty. A caller's symbolic base/head
moving during direct projection is an explicit retry error; session routes pass immutable OIDs and use their
existing outer content-revision fence to retry live HEAD movement. Neither condition may publish zero impact
or certify a falsely current result.

Committed code impact reads the same complete Git-derived event fold as anchor drift, but projects a plain ancestry
window without acknowledgement filtering. Base and head declarations each bind their path identity at that
revision, so deletion, rename chains, path reuse, and incomparable forks retain the same meaning as the gate.
The live overlay derives both path images from one rename-aware change set; a pure rename owns no line, while
a rename with edits intersects the old and new units on their respective sides.

This is the **one product predicate**. Scoped `/api/evals`, its list/detail model, summaries, and export consume
the same projection; none retain a path-only scenario candidate fallback. Each projection reads the base/head
changed-path set once, batch-reads each distinct exact `.spec` tree once for both spec and eval declarations,
and shares selector source/window/hunk results inside that build. The scope's **reading timelines obey the same
rule**: the whole affected node set is read through ONE batched timeline pass, so the off-history content probes
and the anchor probes union across every node in scope and issue one child per probe kind. Reading a timeline
per node inside the scope loop is the same defect one level down — it multiplies a build's Git children by the
node count, and a single open's cost must grow with the selected session's node closure, never with a
per-node or per-reading spawn. It adds no second resident cache, generation,
or gate: the result enters the existing content-revision/projection cache like every other session model.

**The toolbar summary is a coherent projection, not a small fetch.** `sessionEvalSummary` lives beside the
affected selector in this engine and reduces the already-scoped model to seven useful counts: measured,
affected total, fresh pass, fresh fail, measured-but-needing-review, blind, and unknown. The toolbar renders the
four mutually exclusive scenario categories plus unknown, while measured and total remain projection facts for
coherence, paging, exports, and other consumers rather than a second visible aggregate. Each paged
list and bounded detail response carries that exact projection too, so a consumer never re-implements the fold. Each stable build
also carries one content revision over every input that can move the result: the session HEAD, the base branch
HEAD and merge-base, the staged and unstaged diff (renames and untracked content included), scenario declarations
and their semantic hashes/code axes, reading/retraction sidecars, and the trunk remark track that participates in
freshness. A build reads the revision before and after the fold; a mismatch is discarded and recomputed. Thus a
summary and a demand projection bearing the same revision are the same evaluation cut, not two coincidentally similar
reads.

The backend retains a content-addressed, per-session projection cache. Each entry has a process epoch and a
monotonic input generation `g`, a single in-flight build, and the last stable projection. A cache miss is
`loading`; a relevant canonical input event increments `g` synchronously and becomes `updating` while preserving
the last-known value; a stable build publishes `ready` only when both its generation and content revision still
match. A changed generation or revision discards the result and the runner follows the newest generation. An
error is explicit and also preserves last-known. Burst events may coalesce into one build/publication for the
latest generation, but no older compute can overwrite it. The graph snapshot only batch-reads these cached lean
projections; it never runs `buildSessionEvals` once per session row. A single-session READ of that same
cache exists beside the batch one — it mints no entry, schedules no build, and moves no generation — so a
consumer that must NOT build can report the existing projection with its phase. [[manager-cockpit]]'s review
payload is exactly that consumer: this engine calls that payload, so the dependency runs one way only, and
the cockpit reports `loading`/`updating`/`error`/absent as itself rather than as a computed result. Initial cache misses for live sessions may
start one batch, and completion nudges the existing graph mechanism once. Dormant offline history is intentionally
demand-only: the graph emits its loading/last-known projection without scheduling a summary build for every
retained session, while opening that session's scoped Evals route builds only the requested worktree model. This
keeps the toolbar projection useful for active work without turning historical session count into a cold-start
fan-out.

The eager batch is enabled only while a delta graph subscriber owns the current stream era; plain HTTP/CLI
reads therefore expose `loading` or last-known summaries without starting work for retained records. Within an
enabled era, projection builds use a bounded queue rather than `Promise.all` over every live session. The bound
is a runtime capacity control shared by all projects, not a production-size exception: it keeps git children
and per-worktree history indexes from multiplying with session count, while the scoped Evals route remains the
explicit demand path for one opened session.

That demand path has priority inside the same queue. A selected session cancels its own queued summary for the
current generation, waits only for the currently running job, then runs its full model before unrelated queued
summaries; a second demand for the same id joins the first promise. The queue never opens a second concurrency
lane, and ordinary summaries resume after the demand settles. A demand that arrives while its own summary is
already running joins that generation's completion rather than enqueueing a duplicate job.

**Freshness is event-driven.** The one graph stream owns invalidation: refs cover session/main HEAD and merge-base
moves (including CLI remark commits); server remark/eval writes nudge it atomically; each linked worktree is
watched recursively for dirty source, rename, scenario and sidecar edits, and its gitdir index is watched for
stage/reset-only changes. Watch failure or a pathless/overflow-like event increments the generation and places a
keyed observer hold on the affected projection: it stays `updating(lastKnown)` and no compute or demand read may
certify it current while that input axis is unobservable. Holds compose, so restoring one source cannot mask a
second failed source. A successful resubscription removes only its own hold, advances the generation again, and
then performs one authoritative double-read rebuild with the replacement watcher already attached; an edit in
the unwatched interval is therefore inside that rescan. A cold demand route initializes these same canonical
observers even when no graph request preceded it. If it arrives during an observer hold, it waits boundedly for
that recovery transition and only then performs its double-read build; a transient attach failure therefore stays
loading and reaches a current response after authoritative resubscription instead of escaping as a generic 500.
A persistent attach failure remains explicitly unavailable/non-current instead of falling through to a cache
build. No TTL, periodic fingerprint scan, or patrol makes a summary current. The patrol may still repair unrelated
graph state, but never advances an eval generation or certifies this projection. The guarantee is necessarily over
events the OS watcher delivers: an operating system that silently drops an event without an error exposes no fact
a purely event-driven process can detect, and the UI must not claim otherwise.

Every changed file — `spec.md` included — is a **drill-down**: its row expands to the unified diff
(base..HEAD), and further to the full original ↔ new content side by side, all derived from git and inlined
behind native toggles (capped so a huge changeset can't bloat the page). File grouping is complete independently
of scenario impact: a node whose spec.md changed but whose scenarios did not still carries that file row and says
that no declared scenario is affected. Nothing is hidden — the whole diff and both file versions are there to
jump into, no extra fetch.

**The interactive face is the Evals route family, session-scoped** ([[evals-view]]): the canonical
address of a session's evaluation is `#/evals?q=is:eval scope:<id>` (the list — the same
[[evals-feed]] row grammar with the session's gates strip above — its toolbar leading with the
icon-only terminal door as its first focusable control, labelled by the short localized
`Back to session terminal` / `返回会话终端` command ([[evals-view]]) — filed readings ordered newest-first
across source ownership, with this session's measurements ✦-marked and inherited measurements legible by
the absent ✦ rather than a privileged position, then blind spots as inert unmeasured rows — all bounded by
the backend's affected-scenario set; unknown coverage is reported separately from those scenario
rows and counts. A
reading is the session's own iff THIS session filed it or its `codeSha` is one of the branch's commits,
derived, never hand-tagged) and `#/evals/<node>/<scenario>?q=scope:<id>` (the [[event-detail]] page whose
A/B history walks the WORKTREE-rooted readings — the live, remarkable reading of a still-open branch,
what a CI/MR note links; merging first is not required, and the inert `?format=html` export is not the
link). The face fetches `/api/evals` pages for lists and `/api/evals/detail` for the selected scenario's
complete history plus at most five lightweight neighbors. Both are worktree-rooted under `scope:<id>` and
carry no diff enrichment or inlined evidence bytes. It rides the tiered loading every eval face shares: rows first,
evidence streamed from `/api/evidence` only on the detail page. The console and phone session surfaces expose
**DOORS** that are REAL ANCHORS — the console tab bar's `eval ↗` entry and the phone session header's
eval button carry the canonical scoped-list address as their literal href ([[address-routing]]'s one
projection; copy-link and middle-click work for free) and clicking one is a single ordinary hash push
landing directly on the final address — never a console-local eval pane, never a JS-only button, never
the legacy `?session` param; the typed `/eval`
board command opens the same door. The LEGACY address `#/sessions/<id>/eval[/<node>/<scenario>]`
normalizes to the canonical form at the route layer ([[side-nav]] — replace, old links keep working).
The scoped detail exposes no second terminal door: its one small back arrow, plus load-failed and
not-found list links, return to this scoped list; only from the list does the terminal door leave the
Evals hierarchy. There is NO build/typecheck/test gate in the gates strip, because soundness is proven by measuring the
real product, not by a language-specific checker; a session with no worktree/diff shows a clean empty
state.

Interactive full rows are not a transport. A scoped list receives one 25-row page; a scoped detail receives
only its selected row, that scenario's complete history, and at most five lightweight neighbors. Each response
carries the same generation, content revision, and `sessionEvalSummary` projection as the graph field. If the client has already observed a
newer graph generation, it rejects the old response and reloads; equal generations must have equal content
revisions. This fence keeps a slow demand read from repainting newer loss while preserving the tier split: summary
on graph, scenarios/readings on Evals open, evidence bytes on detail expansion.

The **self-contained HTML** (`renderExportHtml`: evidence inlined as data-URIs, every changed file's
diff + before/after drill-down) remains as the **export artifact** — CI attachments, sharing, a bare
browser — behind the session-scoped list's `export ↗` link (labelled as the export it is —
`GET /api/sessions/:id/evals?format=html`; the bare route rejects because interactive JSON uses the paged
review routes), and
`spex eval ls --session <SEL> --export` (`--out`/`--open`, a backend client that works against a remote backend
unchanged). Its cards and denominator project the scoped declarations, not only readings that happen to exist:
each affected missing scenario renders as unmeasured and still counts, while stale readings remain visible.
Inlining everything is the right shape for a file that must stand alone, and the wrong shape
for an interactive page — that is the whole split.

**The CLI mirrors the vocabulary, not just the artifact.** `spex eval ls --session <SEL>` is the
session-scoped list's CLI twin: it walks the same `/api/evals` pages and renders the same attention
order as text by projecting the returned item sequence directly — filed readings newest-first across nodes
and source ownership, the session's own readings ✦-marked and inherited readings distinguished by the absent
✦, then blind spots. A row retains its node label as context; the node is never a grouping key that can move
that row out of the global sequence. An uncovered frontend node remains flagged — all over the same affected-scenario set, so a terminal-bound manager reads the measured loss
without the dashboard. `proof` is no longer a user-facing word at all: the export rides the eval read as
its `--export` flag, and the old `spex review proof` spelling is gone — a signpost names the canonical
form and exits non-zero, never running ([[cli-surface]]). The read/write split stays intact: `spex eval
ls --session` READS a session's evaluation; filing a reading remains `spex eval add`.

The impact snapshot carries PARSED relation entries, not a pair of projections to be reassembled. A node's
relation is one list of `{path, selectors}`; `code`/`related` (bare paths) and `codeScoped`/`relatedScoped`
(the selector-bearing subset) are views derived from it for consumers that want exactly those, and the
snapshot ships the entries themselves alongside. It used to ship only the two views, so the exact-revision
projection minted `path#selector` STRINGS back out of them and handed those to the relation parser to
recover the entries the loader had all along — a serialize/reparse round-trip through a form nobody ever
stored, at five call sites. Nothing validated by that reparse was load-bearing: a snapshot's relation
problems are already carried on the snapshot and already throw before any of it runs, and a reparse of rows
minted from parsed entries cannot surface a problem the original parse did not. One parse, one shape, and
the ordinary loader's and the fixed-revision snapshot's history/window semantics stay distinct — sharing the
relation projection is not licence to collapse those.
