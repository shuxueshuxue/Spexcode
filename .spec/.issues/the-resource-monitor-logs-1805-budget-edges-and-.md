---
concern: the resource monitor logs 1805 budget edges and zero magnitudes host-resource-budget,taste
by: 53f55aa4-83cc-4bb9-95a8-c75666b33d51
status: open
created: 2026-08-05T18:35:36.868Z
---

Spec: host-resource-budget

Measured 2026-08-06 on this ThinkPad's live backend log (`/tmp/spex-backend.out`, 3112 lines,
one `serve` supervisor + child), read-only. No process was signalled and no config changed.

## 58% of the backend log is this monitor, and none of it names a number

    [resources] entered|cleared lines : 1805
    total backend log lines           : 3112     -> 58.0%

    grep -c '^resources @ '   -> 0
    grep -c 'attributed PSS'  -> 0

The transition logger at `host-resources.ts:718-719` emits one line per finding edge. The finding
string it prints has been deliberately stripped of its magnitude first, at `:714-716`:

    const stableFinding = (finding: string) => finding.startsWith('rss-over-budget:') ? 'rss-over-budget'
      : finding.startsWith('idle-cpu-over-budget:') ? 'idle-cpu-over-budget'
        : finding

That strip is **correct for what it was written for** — the raw finding embeds a live MiB value
(`:605`), so comparing raw strings against `last` would re-fire `entered` + `cleared` on every sample
as RSS drifts. Keying the edge on the finding name is the right call.

The consequence is that the magnitude then exists in exactly one place — `formatResourceReport` at
`:697`, `! ${owner.findings.join(',')}` — and that formatter emitted **zero times** in 1805 transitions.
So an operator reading this log is told 1805 times that something crossed a budget, and is never told
by how much, for any owner, at any point.

## Every owner is a perfectly alternating pair, which is the second half of the defect

    orphan:32b7dd20-...    312 entered / 311 cleared
    session:1abba8e1-...   138 / 138
    session:53f55aa4-...    88 /  88
    orphan:9dbe7b0f-...     57 /  55
    session:ef920c6e-...    49 /  48
    backend:ff82b0ad-...     7 /   7

There is no hysteresis: a quantity sitting near its budget crosses back and forth and pays two lines
every crossing, forever. `orphan:32b7dd20` alone spent 623 lines — 20% of the whole backend log —
announcing that one number is oscillating around one threshold, without ever printing either.

Measured on the `backend:` owner, which is the one I could pin: grouping owned pids on
`SPEXCODE_INSTANCE_ID` (the grouping key at `:340/346/355`) and summing RSS the way `ownerTotals`
does at `:555-556` gives

    backend:ff82b0ad-...   members=2   total 1801 MiB   budget 2048 MiB (`backendRssMiB`, :86-92)

— 88% of budget, i.e. exactly the riding-the-threshold shape the 7/7 alternation predicts.

## Why this is worth fixing even though nothing is broken

A log that reports 1805 events and zero magnitudes is not neutral, it is misleading in a specific
direction: it makes a marginal crossing and a catastrophic one look identical, so the reader's only
available summary is the **count** — and the count sums incomparable things. Concretely, in this
session an `entered` edge adjacent to two slow builds was read as a correlation and filed as such; the
full-population test (243 vs 185 builds, 13.2% vs 8.6% extreme, p ≈ 0.17) shows it was chance. Had the
edge carried its magnitude, that reading would have been visibly marginal at the moment it was taken
rather than three hours later. See the retraction thread on
`the-board-budget-warning-logs-a-1-002x-and-a-48x` for that measurement.

This is the same defect family as `one-unrecognised-harness-id-blinds-host-resource`, approached from
the opposite side. That one makes this monitor **silent** and uninformative — a single unparseable row
drops every owner's findings. This one makes it **loud** and uninformative. Neither leaves the operator
able to act, and the deployment where both are live shows 1805 lines of activity for a fault surface
that was blind for most of the window.

## Fix shape (diagnostic only — no gate, no exit code, no policy)

1. Carry the magnitude on the `entered` line. The value is already in hand: keep `stableFinding()` as
   the **edge key** and print the raw finding as the **payload**, so pairing stays stable and the
   number is still reported. One line, no new state.
2. Add hysteresis so a quantity within a small margin of its budget stops logging two lines a minute.
   The natural shape is a clear-threshold below the enter-threshold (the state is already carried in
   `last`), which is one comparison rather than a new mechanism.

## Acceptance

On a deployment with an owner riding its budget: the `entered` line names the magnitude, and the
alternating pair count for that owner over a fixed window drops to a small number instead of tracking
the sample count. Both are readable straight from the log without a new surface.

## Not claimed

- Not claimed that 1801 MiB is a leak, or that this owner should be under budget. Whether 2048 MiB is
  the right budget for a board-producing backend on a 108-worktree checkout is a separate question and
  is not measured here.
- Not claimed that the strip at `:714-716` is a mistake. It is the right key; the omission is that the
  payload went with it.
- The per-owner alternation counts are line counts from one log on one host over one window, not a rate.
