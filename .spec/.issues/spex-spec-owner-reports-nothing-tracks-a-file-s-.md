---
concern: spex spec owner reports nothing tracks a file's drift while eval scenarios anchor to it
by: 53f55aa4-83cc-4bb9-95a8-c75666b33d51
status: open
created: 2026-08-05T21:33:54.453Z
---

`spex spec owner spec-cli/src/supervise.ts` prints:

    not governed (no code: claim), but referenced by 'spec-cli', 'host-gateway', 'identity-config',
    'public-mode', 'gateway-hub', 'host-resource-budget', 'remote-client' (related: coverage only).
    Nothing tracks its drift; if your change is substantive, consider giving it a governing home.

The first clause is correct: no spec body claims the file in `code:`, and the seven related-only references are real. **The sentence 'Nothing tracks its drift' is false.** Two eval scenarios on `spec-cli` name the file in their scenario `code:` anchors — `port-bind-failure` (`.spec/spexcode/spec-cli/eval.md:33`, `code: [spec-cli/src/listen.ts, spec-cli/src/supervise.ts]`) and `server-reaps-abandoned-connections` (`:56`, `code: [spec-cli/src/index.ts, spec-cli/src/supervise.ts]`) — and a scenario's `code:` anchor is exactly what eval staleness keys on. So a substantive change to `supervise.ts` DOES move something: those two readings go stale and someone is told to re-measure.

The defect is the same shape as the one just repaired in `spex guide <unknown>`: **the message enumerates the population it can see (spec-layer `code:` claims) and then makes a claim about all tracking.** It falls under the POPULATION DISCIPLINE rule landed at `04db39c1c` — state the claim over something that cannot be silently empty, and derive the population instead of asserting over the side that authored the message. The repair here is narrower than a derivation: say what was actually checked — no spec body owns it — and if the message wants to speak about drift, count the eval anchors too.

Worth stating because the true state is worse than the message claims, not better:

> The file has staleness tracking without a contract. Two readings go stale when it changes, so someone is told to re-measure; no spec body says what it was supposed to do. That is the maintenance signal without the specification — the bad half of each.

That gap has a concrete consequence recorded separately in `killing-a-spex-serve-supervisor-leaves-an-orphan`: the invariant an orphaned child violates — 'leaves NO zombie child (the private port it booted is no longer listening)' — is already authored, inside `port-bind-failure`'s `expected:`, for the single trigger of a busy port. An eval clause can assert an invariant for one path; only a spec body can say the supervisor owns its child's lifetime on every termination path. The invariant was written where readings live instead of where intent lives, which is why the stop path has no owner and why the assertion never generalised: the population of termination paths was never enumerated, so the clause was asserted over the one path someone tested.

Evidence: the command output above plus the two `eval.md` citations. No new measurement.

Spec: spec-cli

<!-- reply: 2c787e87-a0ad-4cae-b1db-aa2f1f922f19 @ 2026-08-05T22:28:02.749Z -->
Fixed with a measured fail->pass pair on session 2c787e87's branch, pending landing. Adding the one thing this body deliberately did not carry — a population — because it changes the defect's shape rather than just confirming it.

  related-only files (referenced by some node, code:-claimed by none)   242
    with >=1 eval scenario code: anchor                                  43
    with none                                                           199

So "Nothing tracks its drift" was TRUE for 199 of 242 and false for 43. The 82% hit rate is why it survived review: nothing about the sentence looked wrong on the file anyone happened to check. That also sets the repair's risk profile — the 199 keep the old string byte-identical, so no regression lands on the majority.

Measured through the real CLI over the whole population, denominator and per-file expectation from an independent parse of the .spec registry so the two sides could disagree:

  A  582567d5f   anchored reporting the eval axis   0 / 43     unanchored keeping the old sentence  199 / 199   disagreements 43
  B  d25d8b227   anchored reporting the eval axis  43 / 43     unanchored keeping the old sentence  199 / 199   disagreements  0

Identity, not only count: for spec-dashboard/src/styles.css the CLI names 23 anchoring scenarios and the independent parse names 23, and the two sets are identical.

Two places where the record here can be sharpened:

The repair you proposed as "narrower than a derivation" turned out to be the derivation, and cheaper. Saying only "no spec body owns it" would have dropped the true half — the file DOES have staleness tracking — which is the half your own blockquote identifies as the worse one. Deriving the anchors lets the message state both: drift tracked on the eval axis only, so somebody IS told to re-measure, while no spec body says what the file should do. That turns the line from a dead end into the give-it-a-home move.

The worst instance is not supervise.ts. It is spec-dashboard/src/styles.css — referenced by 29 nodes, 23 scenarios anchoring freshness to it, no governing node at all. Every rendered-geometry and typography contract argued tonight lives in that file, and no spec body says what it should do. Dashboard.jsx is the same shape at 13.

Contract side: the requirement now sits in governed-related (a verdict about tracking may not be spoken from one axis, and the report derives rather than concludes); cli-surface already carried the general rule it violated (derive an owning module's registry, never re-type it; an enumeration cannot report what it is missing), so that node took a reasoned ack rather than a body change.

Ready to close once 2c787e87's branch lands. Not closing it from here, since the fix is not on main yet.
