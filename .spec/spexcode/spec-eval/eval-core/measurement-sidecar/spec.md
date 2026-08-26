---
title: measurement-sidecar
status: active
hue: 140
desc: The append-only measurement log beside a spec — one JSON line per event, readings and their retractions, verdicts, and a content-addressed evidence list; nothing is ever deleted or rewritten.
code:
  - spec-eval/src/sidecar.ts
related:
  - spec-eval/src/filing.ts
  - spec-eval/src/cli.ts
  - spec-eval/src/scenarios.ts
  - packages/spec-core/src/layout.ts
---

# measurement-sidecar

A measurement is an EVENT, not a field, so [[eval-core]] keeps its scoreboard in a flat append-only sidecar
rather than in the spec. This node owns that log: what a line may be, how the effective view is folded, and how
a botched filing is withdrawn without losing the trace. What a scenario declared is [[scenario-declaration]]'s;
whether a stored reading still testifies is [[eval-freshness]]'s.

Measurements live apart in a flat
**evals.ndjson** sidecar — **append-only, one JSON line per EVENT**. A filing appends a *reading*
(scenario, codeSha, the **`scenarioHash`** contract stamp (see freshness below), an **evidence LIST** (each entry
a typed `{hash, kind ∈ image|video|transcript|data}` — the render taxonomy ([[evidence-kind-taxonomy]])),
the video entry's optional timelineBlob ([[step-timeline]]),
an optional **`by`** (the SESSION that filed
it, from envSessionId), **verdict**, ts) — the second git-as-database axis: a reading commit is a *measurement
event*, not a spec version, so history and attribution apply unchanged. `by` is the reachable session behind the
filing — the ORIGINATOR an eval-comment thread loops in on a reply ([[mentions]]). It is purely additive: a
legacy reading without it simply has no originator, so the loop-in stays silent; a human filing through the
HTTP route has no reachable session and omits it too. WHO measured is deliberately NOT a schema axis: the
agent is the measuring hand, and the retired per-reading `evaluator` tag (constant `manual@1` on every
reading ever filed) carried zero signal — legacy lines still hold the key, read-tolerated like the scalar
`blob`, rendered if present, never written again.

The sanctioned undo appends a **retraction** — `{retracts: <target reading's ts>, scenario, note?, by?, ts}`
— never deletes or rewrites a line, so a botched filing (a junk e2e/smoke run, a wrong verdict) is reversible
*through the same surface that wrote it* while the trace stays: the target line remains as history, the
retraction event says who withdrew it and why, and git carries both. Every score consumer reads the
**effective view** (readings minus the retracted, joined by (scenario, ts)) through one seam
(`readReadings`), so a retract undoes the filing on freshness, scan, clean's referenced-blob set, the eval
tab, and the proof at once — the previous reading becomes the latest again, or the scenario honestly returns
to `eval-missing`; a retracted reading's blobs simply fall out of the referenced set at the next clean. The
two event kinds are told apart **positively** — a retraction carries `retracts`, a reading carries `codeSha`;
neither is ever recognized by another field's *absence* — and a
retraction matching no reading is inert. The trace stays navigable: the timeline carries the retraction
events beside the effective readings, and `show` renders each as a `⟲ retracted` line.

The **verdict** is the loss against `expected`: `pass` or `fail`. Either may carry an optional **note** — a
one-line annotation (why it failed, how far a pass sits from ideal). A note is an annotation *on* the verdict,
not a third status: a measurement must commit to pass or fail, and a scenario you haven't actually measured is
`eval-missing`, never a hedged note-as-verdict. The **evidence** is a **LIST** of content-addressed entries —
N `image`s and/or a `video` (with its step-timeline) and/or a `transcript` and/or a `data` block ([[evidence-kind-taxonomy]]), each typed by its `kind` (the
captured actual behaviour — the *why* lives there, the note only summarises it). One filing can carry a whole
run: several stills beside the recorded clip. Backward-compatible: a legacy **scalar** reading (one `blob` +
`blobKind`) reads as a one-entry list, so old readings still render; one filed before verdicts existed — or a
legacy note-only reading — renders as *legacy*.

Evidence is content-addressed under the **shared git common dir** ([[portable-layout]]) — one copy per repo,
outside the tree, uncommittable (no .gitignore). A gone blob renders as `miss original file`; a pre-commit
backstop rejects a stray blob or a malformed eval.md. `spec-cli/src/cli.ts` carries only a thin
`eval` drawer route ([[forge-cli]] shape) — eval-core's sole stake in that shared hub.
