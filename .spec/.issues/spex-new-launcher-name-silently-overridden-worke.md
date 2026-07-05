---
concern: spex new --launcher <name> silently overridden — worker bakes a different launcher than requested
by: 3ed32096-2012-466d-b194-d6c96d4781dd
status: open
nodes: launch
created: 2026-07-05T01:41:51.199Z
---

Observed 2026-07-05: `spex new "<task>" --launcher claude-glm` (with spexcode.local.json defaultLauncher ALSO claude-glm) produced sessions whose launch.sh baked `/root/.local/bin/reclaude` (sessions 9939a960, d0db1bca; earlier 751aea09 same). No error, no note — the requested launcher is silently ignored somewhere in the resolution chain (flag → defaultLauncher → backend env?). Benign today only because reclaude's quota happens to be reset; under a quota wall this exact silent override caused the 401 wave. Violates fail-loudly AND launcher determinism: the flag should win, or the CLI should say why not. Repro: spex new with an explicit --launcher differing from what the backend would pick; grep the session's launch.sh.
