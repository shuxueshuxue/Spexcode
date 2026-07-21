---
title: terminal-io
status: active
hue: 280
desc: The live terminal pane and the channels that feed and sustain it — embedding the tmux pane in the browser, the command line living outside xterm, files dropped into the prompt, and the socket that reopens itself after a drop.
related:
  - spec-dashboard/src/SessionTerm.jsx
---
Inside the [[session-console]] the live session is a real terminal, and one cluster of concerns answers a single question — *how does a human read and drive that terminal pane?* These are the live-terminal half of the console; its sibling surfaces ([[session-activity]], [[session-rename]], the list's drag-to-reorder) are the other half — which session you are on and how it is labelled and ordered, not how you drive it.

- [[term-input]] — the contract that the command line lives **outside** xterm: a read-only display, a separate input that owns the keys.
- [[file-attach]] — a file dropped, pasted, or picked on the prompt rides to the worker's `/tmp`, the prompt left holding its path.
- [[reconnect]] — the terminal's socket reopens itself after a real backend drop, with visible backoff, so a pane never needs a manual refresh.

The pane's **normal rendering is event-driven, never polled**. Output actually landing in the buffer is what
drives the best-effort menu sniff (a still terminal is scanned zero times; there is no scanning clock), and
layout events — the entrance animation ending, the host resizing — are what drive the fit (no timer chain
rehearsing it on a schedule). [[live-view]] may use bounded one-shot repaint barriers and a fixed-point helper
recovery scan; neither pulls terminal pixels or refreshes an intact pane. A pane nobody feeds and nobody
reshapes costs nothing in the browser to keep warm.

This node owns no source of its own — each child keeps its files, `[[links]]`, and drift. It exists so the console's terminal cluster reads as one surface, not a flat fan-out beside the session-row surfaces.
