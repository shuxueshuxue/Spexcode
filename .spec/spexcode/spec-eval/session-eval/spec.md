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
  - spec-dashboard/src/SessionInterface.jsx
  - spec-eval/src/sessioneval.test.ts
  - spec-dashboard/src/EvalsPage.jsx
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
backend: `buildExportModel(id)` joins the payload's diff (grouped per spec node) with each changed node's
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

Every changed file — `spec.md` included — is a **drill-down**: its row expands to the unified diff
(base..HEAD), and further to the full original ↔ new content side by side, all derived from git and inlined
behind native toggles (capped so a huge changeset can't bloat the page). Nothing is hidden — the whole
diff and both file versions are there to jump into, no extra fetch.

**The interactive face is the Evals route family, session-scoped** ([[evals-view]]): the canonical
address of a session's evaluation is `#/evals?q=is:eval state:current scope:<id>` (the list — the same
[[evals-feed]] row grammar with the session's gates strip above — its toolbar leading with the
icon-only terminal door as its first focusable control, labelled by the short localized
`Back to session terminal` / `返回会话终端` command ([[evals-view]]) — blind spots leading
as inert unmeasured rows, then the
session's own measurements ✦-marked, then the inherited baseline — other sessions' latest readings; a
reading is the session's own iff THIS session filed it or its `codeSha` is one of the branch's commits,
derived, never hand-tagged) and `#/evals/<node>/<scenario>?q=scope:<id>` (the [[event-detail]] page whose
A/B history walks the WORKTREE-rooted readings — the live, remarkable reading of a still-open branch,
what a CI/MR note links; merging first is not required, and the inert `?format=html` export is not the
link). The face fetches the LEAN model (`GET /api/sessions/:id/evals` — rows only, worktree-rooted, no
diff enrichment, no inlined bytes) and rides the tiered loading every eval face shares: rows first,
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

The **self-contained HTML** (`renderExportHtml`: evidence inlined as data-URIs, every changed file's
diff + before/after drill-down) remains as the **export artifact** — CI attachments, sharing, a bare
browser — behind the session-scoped list's `export ↗` link (labelled as the export it is — the same
`GET /api/sessions/:id/evals` route with `?format=html`; bare, it serves the lean JSON model), and
`spex eval ls --session <SEL> --export` (`--out`/`--open`, a backend client that works against a remote backend
unchanged). Inlining everything is the right shape for a file that must stand alone, and the wrong shape
for an interactive page — that is the whole split.

**The CLI mirrors the vocabulary, not just the artifact.** `spex eval ls --session <SEL>` is the
session-scoped list's CLI twin: it reads the same lean `/evals` model and renders the same attention
order as text — blind spots lead, the session's own readings ✦-marked, the inherited baseline under its
named divider, an uncovered frontend node flagged — so a terminal-bound manager reads the measured loss
without the dashboard. `proof` is no longer a user-facing word at all: the export rides the eval read as
its `--export` flag, and the old `spex review proof` spelling is gone — a signpost names the canonical
form and exits non-zero, never running ([[cli-surface]]). The read/write split stays intact: `spex eval
ls --session` READS a session's evaluation; filing a reading remains `spex eval add`.
