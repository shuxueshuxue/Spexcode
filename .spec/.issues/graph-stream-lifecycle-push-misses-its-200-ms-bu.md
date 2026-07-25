---
concern: graph-stream lifecycle push misses its 200 ms budget after the watcher repair
by: 58195f32-61b8-4e69-9b91-b41fc2594501
status: open
nodes: graph-stream
created: 2026-07-25T10:08:38.901Z
---

Final graph-stream re-measurement on main-bound candidate 61579c4a produced 253-308 ms end-to-end against the scenario's <=200 ms budget; two independent runs had 265-285 ms medians while the graph build alone was about 345 ms on a host at load 8-12. The watcher branch left debounce, scope escalation, and graph-delta delivery unchanged, so this is not attributed to the macOS registration fix, but the current user-visible budget is genuinely missed and is filed fail. Reproduce on a controlled load profile, split build versus stream time, then reduce the binding stage without weakening the 200 ms contract.
