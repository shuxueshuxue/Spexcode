---
title: terminal-io
status: active
hue: 280
desc: The live terminal pane and the channels that drive it — native xterm input, an out-of-band Command Box, files, and resilient transport.
related:
  - spec-dashboard/src/SessionTerm.jsx
---
Inside the [[session-console]] the live session is a real terminal, and one cluster of concerns answers a single question — *how does a human read and drive that terminal pane?* These are the live-terminal half of the console; its sibling surfaces ([[session-activity]], [[session-rename]], the list's drag-to-reorder) are the other half — which session you are on and how it is labelled and ordered, not how you drive it.

- [[terminal-input]] — xterm is the default interactive surface; its native keyboard and IME data drive the same tmux client that renders the pane.
- [[command-box]] — `Cmd/Alt+I` opens the authored control plane for atomic prompts, board verbs, mentions, and presets.
- [[file-attach]] — a file dropped, pasted, or picked on an authored composer rides to the worker's `/tmp`, the composer left holding its path.
- [[reconnect]] — the terminal's socket reopens itself after a real backend drop, with visible backoff, so a pane never needs a manual refresh.

The pane's **normal rendering is event-driven, never polled**. xterm input and output events drive the live
stream, while layout events — the entrance animation ending, the host resizing — drive the fit (no timer chain
rehearsing it on a schedule and no screen-content menu sniff). [[live-view]] may use bounded one-shot repaint barriers and a fixed-point helper
recovery scan; neither pulls terminal pixels or refreshes an intact pane. A pane nobody feeds and nobody
reshapes costs nothing in the browser to keep warm.

This node owns no source of its own — each child keeps its files, `[[links]]`, and drift. It exists so the console's terminal cluster reads as one surface, not a flat fan-out beside the session-row surfaces.
