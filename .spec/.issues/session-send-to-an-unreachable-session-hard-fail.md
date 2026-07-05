---
concern: session send to an unreachable session hard-fails — unify with the forum's offline drain semantics
by: f45d649c-0ef4-4a52-a3fc-223fc0da6e43
status: rejected
nodes: comms
created: 2026-07-02T16:27:27.175Z
---

Reported by 60b8fda9's survey (bitten once): spex session send to a closed/unreachable session exits 2 and drops the message, while the forum's @-dispatch already has an offline -> drain-to-new-worker delivery. One delivery semantic should serve both surfaces; CLI send hard-failing is the odd one out.
