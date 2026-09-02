---
title: session-tmux
status: active
hue: 280
desc: The shared tmux transport and bounded probe primitives used by session lifecycle and record controls.
code:
  - spec-cli/src/session-tmux.ts
related:
  - spec-cli/src/sessions.ts
  - spec-cli/src/session-record.ts
  - spec-cli/src/harness.ts
---

# session-tmux

This module is the one shared transport boundary for session-owned tmux calls. It carries the configured socket
name, bounded probe durations, command execution, and timeout classification. Callers own the meaning of a tmux
answer: a clean non-zero result may prove absence, while a killed or timed-out probe remains unknown. The module
does not own lifecycle, liveness, record, or quarantine policy; it only keeps those callers on the same transport
and timeout facts.

The transport also has an opt-in `SPEXCODE_TMUX_RECORD` recorder. When set, each invocation appends one JSON line
containing the socket, exact argument array, and timeout value before executing the unchanged command. It is
diagnostic evidence for [[session-host]] parity, not a second transport or a product runtime dependency.
