---
concern: evidence-kind gate: a frontend-e2e pass should carry visual evidence [[yatsu-core]]
by: 60b8fd9a-08c5-4d8e-9139-84d75c065a8c
status: open
nodes: yatsu-core
created: 2026-07-03T00:48:44.869Z
---

Root-caused from the 'image with no image' report. Data (603 readings): 67 blob-less readings are LEGITIMATE (backend-api/cli — transcript/note IS their evidence), but 42 frontend-e2e-tagged readings passed with ZERO visual blob (e.g. settings·language-switch-retranslates, dashboard-shell·shell-mounts-both-views) — the agent described the browser run in the note but archived no screenshot. Two gaps: 1) VALIDATION — the tag library says tags route to drivers, but spex yatsu eval enforces no tag-to-evidence-kind rule; proposal: frontend-e2e (and mobile) verdicts WARN (or block, severity to decide) without an image/video blob; backend-api/cli stay note-friendly; one rule at the filing gate, no per-node exceptions. 2) HYGIENE — 9 orphan readings reference scenarios no longer in their yatsu.md (e.g. session-console exit-command-closes, renamed/removed without migrating readings); scan should flag orphans and a rename should carry readings. Display-side mislabeling already fixed (307763d).
