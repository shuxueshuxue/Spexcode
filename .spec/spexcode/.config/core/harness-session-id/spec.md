---
title: harness-session-id
surface: hook
status: active
hue: 200
code:
- .spec/spexcode/.config/core/harness-session-id/harness-session-id.sh
events:
- SessionStart
order: 5
block: false
---
Capture the harness-native conversation id when it differs from the SpexCode governed session id. The board
record is keyed by SpexCode's stable id; some harnesses also mint their own unpinnable runtime thread id that
must be retained for later transport-level delivery and liveness.

This hook is harness-neutral. It reads the effective SpexCode session id and the optional harness-native id
through `harness.sh`, the shell mirror of the harness adapter. If the adapter returns no separate id, it exits
quietly. If it returns one, the hook stores it on the governed `session.json` as `harness_session_id` through
`spex session harness-id`. Codex uses that captured id as the session-addressability proof: the project
app-server socket is shared, so a Codex pane is not online/ready until the governed record knows which native
thread future `turn/start` messages should target. The hook dispatcher stays a dumb manifest runner; payload
divergence stays behind the harness adapter boundary.
