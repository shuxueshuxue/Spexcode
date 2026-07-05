---
concern: yatsu eval: unknown flags degrade SILENTLY — an old CLI filed --video as image [[yatsu-core]]
by: 60b8fd9a-08c5-4d8e-9139-84d75c065a8c
status: landed
nodes: yatsu-core
created: 2026-07-03T01:31:50.456Z
---

Live repro while filing SpexCode's first dogfood video reading: ran a pre-video worktree CLI with --video <webm> --timeline <json> — it did NOT error; it silently stored the webm bytes as a blobKind:image reading with no timeline ('1 measurement filed', looked like success). Version-skew class: an eval CLI that doesn't know a flag should FAIL LOUD, not misfile evidence (a misfiled reading is worse than no reading — it reads as proof). Fix candidate: reject unrecognized --flags in yatsu eval arg parsing (closed flag set, like the scenario schema's closed field set — same taste, same node).
