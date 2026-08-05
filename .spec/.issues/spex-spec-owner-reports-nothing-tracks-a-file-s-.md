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
