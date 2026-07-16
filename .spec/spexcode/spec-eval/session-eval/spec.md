---
title: session-eval
hue: 150
desc: A session's fully-derived evaluation — the console's Eval tab (the shared eval components, session-scoped, tiered loading) and its CLI twin `spex eval ls --session <SEL>`, over the same worktree-rooted engine that renders the self-contained HTML as an EXPORT artifact (`--export`). No agent authoring.
code:
  - spec-eval/src/sessioneval.ts
related:
  - spec-cli/src/index.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/client.ts
  - spec-dashboard/src/SessionInterface.jsx
  - spec-eval/src/sessioneval.test.ts
  - spec-dashboard/src/SessionEval.jsx
---
# session-eval

## raw source

A human deciding whether to merge — or just wanting to see what a session has done so far — shouldn't have to
hand-read the diff and hunt the evidence. Give them one **proof of work** — the session's measured eval readings
evidence, its diff, and the merge gates, in a single beautiful page, available for **any** session (it comes
into its own at review, but the human can open it any time). It is **fully DERIVED**: it costs the agent nothing
and can never go stale, because it is built from what the system already knows and **generated on the fly
each time it is opened**. This is the optimizer's measured loss, marshaled at the moment a human decides.

## expanded spec

**One engine, thin faces** (the [[eval-history]] / `buildBoard` pattern). The engine is `sessioneval.ts` in
[[spec-eval]] — the marshaled *evaluation* lives with the evaluation package and is the
one place the eval engine reaches into the review state ([[manager-cockpit]]'s `reviewPayload`). It runs ONLY on the
backend: `buildExportModel(id)` joins the payload's diff (grouped per spec node) with each changed node's
[[eval-tab]] timeline (latest reading per scenario — verdict, expected, the content-addressed
evidence) and the gates; `renderExportHtml(model)` emits ONE self-contained HTML document, evidence inlined
as data-URIs ([[eval-core]]'s cache) so it stands alone as a plain file. The eval timelines are rooted at
the **session's worktree**, so freshness and readings reflect that branch, not the backend's checkout. The
headline is DERIVED (the node, else the branch) — there is no agent-authored claim, manifest, or narrative.
A frontend node with no eval.md shows as an honest blind spot, never hidden.

Every changed file — `spec.md` included — is a **drill-down**: its row expands to the unified diff
(base..HEAD), and further to the full original ↔ new content side by side, all derived from git and inlined
behind native toggles (capped so a huge changeset can't bloat the page). Nothing is hidden — the whole
diff and both file versions are there to jump into, no extra fetch.

**The faces split by purpose — the interactive face is the eval component family, the artifact is the
export.** The dashboard's face is the console right pane's **Eval tab** (Terminal / Eval; the typed
`/eval` board command switches to it): the THIRD scope of the ONE eval component family — the node
popup reads one node, the Evals page reads the project, this tab reads *this session* — the same rows, the
same [[event-detail]] detail, inside the SAME master-detail shell the Evals page renders ([[evals-view]]'s
shared `EvalMasterDetail`: the split, the fold-to-a-strip, the j/k walk — no session-only clone of the
geometry or the keys). It fetches the LEAN model (`GET
/api/sessions/:id/evals` — rows only, worktree-rooted, no diff enrichment, no inlined bytes) and rides the
tiered loading every eval face shares: collapsed scenario rows first, evidence streamed from
`/api/evidence` only when a row opens. It also keeps the same native reading affordances as the top-level
Evals page: browser text selection inside the eval workspace is allowed, and the session console's
input-focus retention must never cancel the Eval tab's mousedown defaults. Rows order by attention — and every row must be legible as WHAT
it is, because a reviewer misreading the inherited baseline as the session's own output is this face's one
fatal failure: **blind spots lead** (declared, never measured — the outstanding loss), then the session's
own measurements ✦-marked (a reading is the session's own iff THIS session filed it or its `codeSha` is
one of the branch's commits — derived from the reading, never hand-tagged; filing alone counts, else a
session that measured without committing code reads as if it did nothing), then the **inherited
baseline** — other sessions' latest readings — **default-collapsed** behind an explicit divider naming it:
the divider is the group's toggle, carrying its inherited-row count so the folded baseline stays legible
and an obvious expand/collapse affordance; expanding reveals the same rows in place. The fold changes
only visibility, never semantics — a collapsed row leaves the selection walk exactly as a filtered row
does, and a count chip still narrows the list to the session's own alone (while it narrows, the inherited
divider withdraws with its rows). The rows are the DECLARED scenarios' current score, the same
latest-per-scenario computation every eval face reads (each row carrying its ✓/✗, muted when stale) — a
retired scenario's residual reading contributes no row. A gates strip (the same
`reviewPayload` numbers `spex session review` prints — lint memoized on the checkout fingerprint,
[[manager-cockpit]]) sits above; there is NO build/typecheck/test gate, because soundness is proven by
measuring the real product, not by a language-specific checker. When the session has no worktree/diff the
tab shows a clean empty placeholder. The pane has a second interactive home: the phone's session detail
([[mobile-ui]]) flips to the SAME component behind its header eval entry — lazily loaded, restacked to one
column by the phone's CSS; no mobile clone of the rows, the order, or the detail.

The **self-contained HTML** (`renderExportHtml`: evidence inlined as data-URIs, every changed file's
diff + before/after drill-down) remains as the **export artifact** — CI attachments, sharing, a bare
browser — behind the tab's `export ↗` link (labelled as the export it is, tooltip naming the self-contained
HTML report — the same `GET /api/sessions/:id/evals` route with `?format=html`; bare, it serves the lean
JSON model), and
`spex eval ls --session <SEL> --export` (`--out`/`--open`, a backend client that works against a remote backend
unchanged). Inlining everything is the right shape for a file that must stand alone, and the wrong shape
for an interactive tab — that is the whole split.

**The CLI mirrors the vocabulary, not just the artifact.** `spex eval ls --session <SEL>` is the Eval tab's CLI twin:
it reads the same lean `/evals` model and renders the same attention order as text — blind spots lead,
the session's own readings ✦-marked, the inherited baseline under its named divider, an uncovered
frontend node flagged — so a terminal-bound manager reads the measured loss without the dashboard.
`proof` is no longer a user-facing word at all: the export rides the eval read as its `--export`
flag (named for what the artifact IS — an export — not for the legacy noun), and the old
`spex review proof` spelling is gone — a signpost names the canonical form and exits non-zero, never running ([[cli-surface]]). The read/write split stays intact: `spex eval ls --session` READS a session's evaluation;
filing a reading remains `spex eval add`.
