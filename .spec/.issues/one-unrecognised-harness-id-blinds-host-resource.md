---
concern: one unrecognised harness id blinds host resource monitoring for every owner, silently
by: 2c787e87-a0ad-4cae-b1db-aa2f1f922f19
status: open
nodes: host-resource-budget, shared-runtime-generation-rotation, taste
created: 2026-08-05T18:20:02.499Z
---

Spec: host-resource-budget, shared-runtime-generation-rotation

Measured on the live mirror deployment (`:8790`, 476-node corpus) **read-only** — via `/proc`, `ss`, and
its log. Nothing was restarted; that constraint is what made the defect visible for this long.

## The reading

`[resources] sample failed: unknown harness 'zcode' (known: claude, codex, opencode, pi, claude-headless,
opencode-headless, pi-headless, codex-headless)` — **166 consecutive times**, and it is still going.

The number that matters is not 166, it is what sits on either side of the first one:

```
[resources] entered/cleared transitions BEFORE the first failure : 22
[resources] entered/cleared transitions AFTER  the first failure :  0
supervisor uptime                                                : 3h44m
reportIntervalMs (default, not configured on this deployment)     : 60_000
```

So the host resource report worked, and then stopped, and has produced **nothing** for roughly the last
2h46m of a 3h44m process life. Not degraded — absent.

## Mechanism, three sites

- `spec-cli/src/host-resources.ts:232` — `harnessById(rec.harness || defaultHarness.id)`, inside
  `sharedDescriptors`'s per-record loop, over every session record on disk.
- `spec-cli/src/harness.ts:2946-2952` — `harnessById` throws on an unknown id **deliberately**. Its own
  comment says: *"Throws on an unknown id — fail loud, never silently default."* That is correct, and it
  should not be softened. It is also derived, not a second hardcoded list (`HARNESSES.map((x) => x.id)`),
  so nothing here is a taste-23 violation.
- `spec-cli/src/host-resources.ts:713` — `startResourceMonitor`'s `try` wraps the **entire**
  `await collectResourceReport()`. `sharedDescriptors` is called at `:515` and `:322`, i.e. **before any
  owner is constructed**, so one unresolvable record discards every owner's findings, not just its own row.

The defect is not the resolver and not the registry. It is that a **fail-loud-per-item resolver is being
called inside a host-wide sweep with no per-item containment.** `harnessById`'s loudness is right at a
*request* boundary, where the throw reaches the human who named that harness. `sharedDescriptors` is not a
request boundary: it sweeps historical records nobody is currently asking about. Generalised:

> A fail-loud resolver is correct at a request boundary and wrong inside a sweep, because a sweep's inputs
> include rows nobody asked about.

## Three consequences, deliberately separate

1. **Every owner's findings are lost**, not the bad row's. `session:*:rss-over-budget`,
   `shared:*:orphan-shared-runtime`, `archived-runtime-hazard`, `session-record-corrupt` — all of it.
2. **`last` is never reassigned**, so the entered/cleared diff holds a baseline from before the outage. If
   the report ever recovers, the first transitions are computed against stale state.
3. It emits **one identical `console.error` per interval, forever** — 166 lines saying the same thing, and
   not one line saying *monitoring is down*. Nothing escalates on repetition.

## Why the silence is the expensive half

On the product surface, "no findings" and "healthy host" render identically. This is the [[taste]] 21
shape: a clean, self-consistent, confidently wrong answer, with nothing in the loop objecting.

And the cost is not hypothetical tonight. The single most useful diagnosis produced on this box in the last
few hours came from exactly this instrument — a `rss-over-budget` finding on the board-producing backend is
what moved the reasoning off CPU contention and onto heap pressure. On a deployment holding one `zcode`
session record, that finding never appears. The operator sees a quiet resource surface, concludes the host
is fine, and goes back to reasoning about loadavg — which is precisely the wrong-resource trap the finding
existed to prevent. **The defect manufactures the epistemic state the instrument was built to escape.**

## Why it is live right now, and why that is not the interesting part

`spec-cli/src/supervise.ts:18` starts the monitor in the **supervisor**, which never hot-reloads itself.
Its harness registry is frozen from before `zcode` was registered. The log carries 4
`[supervisor] reloaded (code change)` markers — the child reloaded onto trunk code four times and none of
them helped, because the sampler is not in the child. A full restart is the only clear, and `:8790` is
under observation and must not be restarted.

That version skew is only **how I found it**. Two ordinary paths reach the same abort with no skew at all:

- a record naming a harness whose plugin has since been removed;
- a record naming a harness id that was later renamed.

Session records outlive the config that created them, so an unresolvable `rec.harness` is a *normal*
long-lived state for this sweep to encounter, not an anomaly.

## Fix shape (shape only — not filed as done)

Contain at the aggregation, never at the resolver. A host-wide sweep should skip nothing silently: surface
the unresolvable record as a **finding on that owner** naming the unknown id, so the dashboard shows the
cause instead of silence. That is [[taste]] 15's "loud degradation when a tier is unavailable" applied one
level inward — the harness tier is unavailable *for one row*, and exactly one row should say so.

A second, cheaper guard worth considering independently: `startResourceMonitor` currently cannot report its
own outage. A repeated identical sample failure should escalate rather than reprint — 166 identical lines
is the log telling you it has nothing to say.

## Proof shape when someone fixes it

Load-independent, no backend spawned, no stopwatch. Build records where one carries an unrecognised harness
id, call the real `collectResourceReport`, and assert the report still contains the *other* owners' findings
— a set-membership assertion. The fail→pass pair is available against current committed behaviour, since
today the call rejects rather than returning a partial report.
