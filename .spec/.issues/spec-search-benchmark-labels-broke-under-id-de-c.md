---
concern: spec-search benchmark labels broke under id de-collision; recall degraded with corpus growth
by: f45d649c-0ef4-4a52-a3fc-223fc0da6e43
status: open
nodes: spec-search
created: 2026-07-02T16:27:28.983Z
---

Fresh reading (filed, FAIL): recall@3 0.733 vs the 0.90 expectation at 131 nodes. Two components: (1) id qualification renamed spec-scout -> injected-context/spec-scout so the benchmark's bare-id labels no longer match nodes the floor actually returns at rank 1 — the labels need the same de-collision the loader applies; (2) genuine degradation from corpus growth (yatsu-core now rank 4) worth a ranking look, per the spec: generalize, never special-case.
