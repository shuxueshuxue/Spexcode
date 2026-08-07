---
concern: spec owner still judges the uncovered branch from the spec axis alone — the two-axis rule landed on one of its two branches
by: 0edd38cf-8197-44c6-876d-b63410c7ee4f
status: open
nodes: cli-surface, governed-related
created: 2026-08-07T13:37:41.180Z
---

`582567d5f` wrote the rule generally — a report about what tracks a file may not be spoken from one of
the two tracking axes — and `88d287d6f` implemented it on one of the two branches that speak such a
report. The other branch still speaks the stronger sentence from the spec axis alone.

## The two branches (`spec-cli/src/cli.ts`, `spec owner`)

```
:473  if (owners.length === 0 && related.length === 0)
        -> "no spec claims this yet (uncovered). If your change is substantive, give it a home"
        -> the eval axis is never consulted
:475  else if (owners.length === 0)
        -> enumerates evalNodes/scenarioCodeAxis, then says either
           "tracked on the eval axis only: N scenarios anchor…" or "Nothing tracks its drift"
```

The fixed branch is the weaker claim (`not governed`). The unfixed one is the stronger claim
(`uncovered`), and it is the branch where an eval anchor is more likely to be the *only* thing
holding the file — the governed-related spec says so itself: reaching a no-`code:` state means a
scenario can only anchor by an explicit `code:` of its own, which is exactly the case a spec-axis
enumeration cannot see.

The scenario that proves the fixed branch scopes itself out of this one by construction:

```
owner-report-consults-both-tracking-axes
  "Ask the real CLI for `spec owner` on EVERY related-only file"
```

`related-only` is branch `:475`. Branch `:473` is outside its population, so a green run says
nothing about it.

## Measured today: latent, not live

```
files explicitly anchored by an eval scenario code:            143
of those, with no node code: claim AND no related reference:     0
```

So no file currently reaches `:473` while an eval scenario anchors it. **The defect is real and
latent; it is not producing a wrong answer today.**

That measurement is why this is filed instead of fixed. Making it fail on demand means adding a
scenario `code:` anchor to a file nothing else references — manufacturing the failing case in order
to justify the repair. The repo's own rule is that a bug fix carries a fail→pass pair from a
scenario that was violated, not one built to be violated.

## What would make it live

Any node that anchors a scenario to a file no node `code:`-claims and no node lists in `related:` —
a fixture, a generated artifact, a script reached only from a test. On that day `spec owner` calls
the file "uncovered" while a scenario's freshness already depends on it.

## The general form, worth stating once

A tool message that enumerates one axis cannot pass judgement on the whole model. The hub carries
this rule for its own messages ([[cli-surface]]) and `governed-related` now states it for this
report. This issue is the gap between stating it and implementing it in both places it is spoken.
