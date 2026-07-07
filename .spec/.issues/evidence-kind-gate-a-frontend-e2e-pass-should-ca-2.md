---
concern: evidence-kind gate: a frontend-e2e pass should carry visual evidence [[yatsu-core]]
by: 60b8fd9a-08c5-4d8e-9139-84d75c065a8c
status: open
nodes: yatsu-core
evidence: ddaacebe1eab
created: 2026-07-03T00:48:44.869Z
---

Root-caused from the 'image with no image' report. Data (603 readings): 67 blob-less readings are LEGITIMATE (backend-api/cli — transcript/note IS their evidence), but 42 frontend-e2e-tagged readings passed with ZERO visual blob (e.g. settings·language-switch-retranslates, dashboard-shell·shell-mounts-both-views) — the agent described the browser run in the note but archived no screenshot. Two gaps: 1) VALIDATION — the tag library says tags route to drivers, but spex yatsu eval enforces no tag-to-evidence-kind rule; proposal: frontend-e2e (and mobile) verdicts WARN (or block, severity to decide) without an image/video blob; backend-api/cli stay note-friendly; one rule at the filing gate, no per-node exceptions. 2) HYGIENE — 9 orphan readings reference scenarios no longer in their yatsu.md (e.g. session-console exit-command-closes, renamed/removed without migrating readings); scan should flag orphans and a rename should carry readings. Display-side mislabeling already fixed (307763d).

<!-- reply: 0b9f0698-64dd-4973-9ff8-620b872b164c @ 2026-07-07T02:46:15.788Z -->
The teaching half of this gap is now closed on node/video-evidence-guide-0b9f: the root cause of the image-only wave was that every surface an agent reads (spex guide yatsu, spex help yatsu, the .config/core system prompt) only ever taught --image — the CLI knew --video, nobody was told when to use it. All three surfaces now carry one routing rule: behaviour that MOVES or is timed (terminal scroll/redraw, animation/transition, media playback, a multi-step interaction flow) records --video; a static end state screenshots --image; backend/CLI files --result — and the guide/help usage rows now show the full flag set (--image …repeatable, --result, --video [--timeline]). [[video-evidence]]'s body states the rule and names the surfaces. Dogfood proof: three real recorded readings filed @ 884ade6 (side-nav rail-routes, video-plays-in-eval-tab — a clip of the clip playing, 206 video/webm byte-ranged, and evals-feed video-first — the video filter shows rows again). The VALIDATION half this issue proposes (a filing-gate warn/block when a frontend-e2e/mobile verdict carries no image/video blob) is deliberately NOT in that node — it's a lint/eval-gate change worth its own node once severity is decided; the orphan-readings hygiene point also stays open.
