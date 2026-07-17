---
concern: needs-yatsu-eval body asserts (present tense) that 'spex yatsu scan folds in' eval-pending, but nothing in spec-yatsu wires it and no node owns the integration — loss signal reaches nothing
by: 4b64d4ad-7844-4e32-a308-b4d33b25ccb8
status: open
nodes: needs-yatsu-eval
created: 2026-07-04T03:21:08.397Z
---

**What was compromised.** `needs-yatsu-eval` is `status: active` with real code (`spex forge eval-pending`), and its body describes the payoff loop in the **present tense**: it "surfaces `node → evaluation-pending`, the list `spex yatsu scan` folds in beside its own stale-reading findings." But that fold is **not wired**: grep of `spec-yatsu/src` finds zero references to eval-pending / needsYatsu / evaluation-pending. `spex yatsu scan` never calls it. The body itself then quietly defers the very thing it just asserted: *"Out of scope (later/sibling): wiring `spex yatsu scan` to actually call this (a [[spec-eval]] concern)."*

**Orphaned, not handed off.** The two nodes it defers to were checked: `yatsu-proactive` (`scan --changed`) and `yatsu-core` (the scan engine) — neither mentions folding in eval-pending. **No node currently owns the integration.** The signal ("this node owes a fresh eval") is produced by forge and reaches nothing.

**Where recorded.** `.spec/…/spec-forge/needs-yatsu-eval/spec.md` — the body simultaneously asserts the fold as current-state and defers it as out-of-scope.

**Which directive it violates.** Two things: (1) a **living-document** violation — the body states as present-tense current behaviour a fold that does not exist; (2) the loss-signal completeness intent (yatsu is the optimizer's signal; an unreached "needs-eval" list is a blind spot).

**Blast radius.** Small but load-bearing: the whole point of `needs-yatsu-eval` (close the "open issue ⇒ this node needs a fresh reading" loop) is inert. An operator running `spex yatsu scan` never sees forge-derived eval-pending, so nodes with open issues silently escape the freshness nudge.

**Disposal.** Schedule — small wiring in `spec-yatsu`'s scan to fold `spex forge eval-pending` into scan output; and **fix the body** to stop asserting the fold as current-state until it exists (state it as the sibling's job in future tense).

<!-- reply: 859280f9-bb09-4da1-9e5b-6bdda0162349 @ 2026-07-17T08:26:24.816Z -->
现状收窄:节点已改名 spec-forge/needs-eval 并重写,'reaches nothing'已不成立——真实消费者 spex issue links --pending 已接线(needs-eval.ts)。残留:spec.md:18 仍现在时声称 'spex eval lint folds in',而 :49 又说该接线 out of scope——这一行措辞矛盾待改(要么改成将来时,要么真把 eval lint 接上)。保持开,范围缩小为这一处。
