---
title: review-proof
hue: 150
desc: A fully-derived proof of work for any session — its yatsu evidence (measured loss), the diff, and the merge gates, rendered as one self-contained HTML on the fly when viewed. One backend engine; CLI, dashboard (an always-available Proof tab), and a bare browser are thin faces. No agent authoring.
code:
  - spec-yatsu/src/proof.ts
  - spec-dashboard/src/ReviewProof.jsx
related:
  - spec-cli/src/index.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/client.ts
  - spec-dashboard/src/SessionInterface.jsx
---
# review-proof

## raw source

A human deciding whether to merge — or just wanting to see what a session has done so far — shouldn't have to
hand-read the diff and hunt the evidence. Give them one **proof of work** — the session's measured yatsu
evidence, its diff, and the merge gates, in a single beautiful page, available for **any** session (it comes
into its own at review, but the human can open it any time). It is **fully DERIVED**: it costs the agent nothing
and can never go stale, because it is built from what the system already knows and **generated on the fly
each time it is opened**. This is the optimizer's measured loss, marshaled at the moment a human decides.

## expanded spec

**One engine, thin faces** (the [[yatsu-show]] / `buildBoard` pattern). The engine is `proof.ts` in
[[spec-yatsu]] — a proof IS the marshaled *evaluation*, so it lives with the evaluation package and is the
one place yatsu reaches into the review state ([[manager-cockpit]]'s `reviewPayload`). It runs ONLY on the
backend: `buildProofModel(id)` joins the payload's diff (grouped per spec node) with each changed node's
[[yatsu-eval-tab]] timeline (latest reading per scenario — verdict, expected, the content-addressed
evidence) and the gates; `renderProofHtml(model)` emits ONE self-contained HTML document, evidence inlined
as data-URIs ([[yatsu-core]]'s cache) so it stands alone as a plain file. The eval timelines are rooted at
the **session's worktree**, so freshness and readings reflect that branch, not the backend's checkout. The
headline is DERIVED (the node, else the branch) — there is no agent-authored claim, manifest, or narrative.
A frontend node with no yatsu.md shows as an honest blind spot, never hidden.

Every changed file — `spec.md` included — is a **drill-down**: its row expands to the unified diff
(base..HEAD), and further to the full original ↔ new content side by side, all derived from git and inlined
behind native toggles (capped so a huge changeset can't bloat the page). Nothing is hidden — the whole
diff and both file versions are there to jump into, no extra fetch.

The faces are thin and all show the identical bytes. The backend serves `GET /api/sessions/:id/proof` (HTML;
`?format=json` = the model). `spex review proof <SEL>` is a backend CLIENT ([[remote-client]]) that fetches
that HTML and writes (`--out`) or opens (`--open`) it, so it works against a remote backend unchanged. In the
dashboard ([[session-console]]) the proof is a **first-class, always-available view**: the console's right
pane is a **Terminal / Proof** tab pair, and the **Proof tab** renders this HTML **inline** — fetched once and
mounted via `srcDoc` (the document is self-contained, so no second request), for **any** selected session,
not only one in review and not a floating overlay. When a session has no proof to show yet — no worktree or
diff, so the route 404s — the tab shows a clean **empty placeholder** in place of the artifact. The typed
**`/proof`** board command (cyan) and clicking the tab both switch to it; the tab-state lives in the console,
this node owns only the inline rendering. Because the proof is DERIVED, the tab **rebuilds it on each visit**,
so it always reflects the live diff/loss/gates.

Out of scope: the measurement engine and freshness ([[yatsu-core]]); the per-node eval tab
([[yatsu-eval-tab]]); the merge dispatch ([[manager-cockpit]]). This node only marshals what they already
produce into the review's proof — nothing is authored, only read.
