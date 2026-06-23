---
title: review-proof
hue: 150
desc: The agent's review state, marshaled — proposing merge presents one self-contained HTML proof of work that weaves its yatsu evidence (measured loss), the diff, and the merge gates under an authored claim. One backend engine; CLI, dashboard, and a bare browser are thin faces.
code:
  - spec-yatsu/src/proof.ts
  - spec-cli/src/index.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/client.ts
  - spec-dashboard/src/ReviewProof.jsx
  - spec-dashboard/src/SessionInterface.jsx
---
# review-proof

## raw source

A merge proposal is a CLAIM — "I drove the loss down, land me." Today that claim is a one-line note and the
human still hand-reads the diff and hunts the evidence. Give the claim a BODY: when an agent enters the
review state it can present a single, beautiful **proof of work** — its measured yatsu evidence, the diff it
made, and the merge gates, gathered under a headline it authors. This is the optimizer showing its loss
measurements at the one moment a human decides. It is OPTIONAL and AGENTIC: the proof always renders from
what the system already knows; the agent only enriches it by filling a thin schema. yatsu owns the heavy
assets — the proof references readings, never a second asset store.

## expanded spec

**One engine, thin faces** (the [[yatsu-show]] / `buildBoard` pattern). The engine is `proof.ts` in
[[spec-yatsu]] — a proof is the marshaled *evaluation*, so it lives with the evaluation package and is the
one place yatsu reaches into the review state ([[manager-cockpit]]'s `reviewPayload`) plus the worktree. It
runs ONLY on the backend: `buildProofModel(id)` joins the payload's diff (grouped per spec node), each
changed node's [[yatsu-eval-tab]] timeline (latest reading per scenario — verdict, expected, the
content-addressed evidence), the gates, and the agent's manifest; `renderProofHtml(model)` emits ONE
self-contained HTML document, evidence inlined as data-URIs ([[yatsu-core]]'s cache) so it stands alone as a
plain file. A frontend node with no yatsu.md shows as an honest blind spot, never hidden.

The faces are thin. The backend serves `GET /api/sessions/:id/proof` (HTML; `?format=json` = the model).
`spex review proof <SEL>` is a backend CLIENT ([[remote-client]]) that fetches that HTML and writes or opens
it — so it works against a remote backend with no extra logic; `--scaffold` is the one LOCAL act, dropping a
`.session/proof.md` template into the cwd worktree. The dashboard ([[session-console]]) adds a **proof**
action on a review/done session that opens the same route in an overlay — natural support, still just the
artifact. All faces show the identical bytes the backend rendered.

**The schema the agent fills** — `.session/proof.md`, a [[runtime]] sidecar, deliberately LENIENT (not the
strict yatsu.md validator): an optional `claim` headline plus a free markdown narrative the renderer weaves
above the evidence. Absent or partial is fine — the claim falls back to the proposal note and the proof
still renders. The pressure it creates is the point: a rich proof comes from MEASURING your nodes, so it
rewards the [[yatsu-proactive]] loop instead of adding a parallel one.

Out of scope: the measurement engine and freshness ([[yatsu-core]]); the per-node eval tab
([[yatsu-eval-tab]]); the merge dispatch ([[manager-cockpit]]). This node only marshals what they produce
into the review's proof.
