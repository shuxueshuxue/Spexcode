---
concern: port gugu's .agent/skills/e2e as a SpexCode skill node — import the WORKFLOW, collapse the tooling [[harness-delivery]]
by: 60b8fd9a-08c5-4d8e-9139-84d75c065a8c
status: open
nodes: harness-delivery
created: 2026-07-03T01:14:28.085Z
---

User order: formally integrate https://github.com/nmhjklnm/gugu/tree/main/.agent/skills/e2e into the system.

WHAT IT IS: gugu's e2e review skill — split POOL-mode worker recordings into per-spec clips by timeline events (prep.py + *.timeline.json '▶ spec' markers), then a standalone local web annotator (circle/comment/frame-PNG/MD-JSON export). It is the ANCESTOR of what already landed in SpexCode today.

THE TASTE CALL — import the workflow, not duplicate tooling. Already IN SpexCode (do NOT re-ship): the annotator (dashboard detail pane: seek/circle/comment + eval-comments threads), video evidence (blobKind video + Range serving), step timelines (spec-yatsu timeline.ts + eval --video --timeline), report→reading (fileHumanReading). The skill's standalone HTML annotator/serve_range/save-frame stack collapses onto these.

WHAT PORTS: a new .config node with surface: skill (the EXISTING mechanism — folder = skill bundle, spec.md body = the SKILL.md, co-located scripts ride; materialized per harness like [[taste]]). Content: ① WHEN — after an e2e run that recorded pooled video, or when the human says 审录屏/标注/annotate; ② HOW — split recordings per SCENARIO by timeline markers (port prep.py, generalized: input = any dir of webm + timeline.json pairs; gugu's video-timeline event shape maps to spec-yatsu's timeline format), then file each clip with spex yatsu eval <node> --scenario <s> --video <clip> --timeline <tl>, then point the human at the DASHBOARD annotator (#/forum evals region) for review/annotation/comments — not a second web UI. ③ Vendor bits genericized: no hardcoded test-results/pool-video-w*, no annot-meta.json 32-spec table (scenario names come from the timeline markers; the yatsu.md IS the metadata).

FIRST CONSUMER: gugu itself (a governed deployment) — acceptance = run the ported skill against a real gugu e2e recording set end-to-end.

OWNER: video line (ded8) — they authored both sides.
