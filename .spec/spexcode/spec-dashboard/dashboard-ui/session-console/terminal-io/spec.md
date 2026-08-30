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
- [[terminal-transport]] — the terminal host receives one injectable connection seam; dashboard transport details stay at the host boundary.
- [[command-box]] — `Alt+I` opens the authored control plane for atomic prompts, board verbs, mentions, and presets.
- [[file-attach]] — a file dropped, pasted, or picked on an authored composer rides to the worker's `/tmp`, the composer left holding its path.
- [[reconnect]] — the terminal's socket reopens itself after a real backend drop, with visible backoff, so a pane never needs a manual refresh.

The pane's **normal rendering is event-driven, never polled**. xterm input and output events drive the live
stream, while layout events — the entrance animation ending, the host resizing — drive the fit (no timer chain
rehearsing it on a schedule and no screen-content menu sniff). [[live-view]] may use bounded one-shot repaint barriers and a fixed-point helper
recovery scan; neither pulls terminal pixels or refreshes an intact pane. A pane nobody feeds and nobody
reshapes costs nothing in the browser to keep warm.

This node owns no source of its own — each child keeps its files, `[[links]]`, and drift. It exists so the console's terminal cluster reads as one surface, not a flat fan-out beside the session-row surfaces.

## the terminal surface, as the console mounts it

The terminal mount keys on **liveness, never the lifecycle label**: a session whose process is gone reads `offline`
whatever its authored lifecycle (`asking`, `review`, `error`, …), so it never mounts a tmux client against a dead
id (which would leak tmux's bare "no sessions" into the pane). The terminal pane is **flat** and read-safe: it fills the right area directly — no inner bordered box, no title bar,
no nested levels, and no permanently reserved second-input strip. Its own prompt and status line reach the
pane's bottom edge. Opening or selecting a live session keeps this pane writable: typing is the basic terminal
operation. Opening or switching never resumes a stopped process, consumes a token, or replays input. A live
suspended TUI gates only its first actual key behind the non-focused resume confirmation described by
[[terminal-input]]; archived/offline records have no terminal pane and remain read-only Conversation surfaces.

The TUI owns keyboard input through xterm's native IME-aware path ([[terminal-input]]), while text still
selects and the wheel scrolls **the tmux pane's real history** — normal output through tmux copy-mode, mouse-owning TUIs by
forwarding the wheel to the app ([[live-view]] owns the adapter decision), with no browser-owned terminal
scrollbar competing with tmux — a drag selects even under mouse-reporting, and `⌘/Ctrl+C` copies to the clipboard **over HTTPS, localhost,
or plain HTTP** (past the secure-context-only Clipboard API). Selection changes highlight only: its first and
last cells remain legible, and moving an endpoint never shifts the terminal's glyph grid. The browser renderer
forwards keyboard data but no pointer reports, so it never enters the application's mouse-report modes;
the public terminal parser consumes those mode toggles at the adapter boundary. Pointer drag therefore remains
one uninterrupted local selection even when a TUI redundantly reasserts its mouse modes, while wheel navigation
continues through [[live-view]]'s explicit tmux-client control path.

For a pane-backed console, input has **two explicit channels**. [[terminal-input]] is the default: xterm owns ordinary keys, paste, and
browser IME composition and sends its ordered data through the visible terminal WebSocket into the same native
tmux client that renders the agent's TUI. Re-selecting the active session or Terminal tab restores xterm focus
without first ending its composition. There is no dashboard type mode, general raw-key vocabulary, menu sniff,
or per-keystroke HTTP batching; the adapter's one modified-key bridge encodes Shift+Enter as `ESC CR`, matching
Codex and Claude inside true tmux.

Pane-backed terminals are **warm and always connected**: every live pane mounts and opens its socket when the
console is first entered — never lazily on focus — and stays mounted even while the console is closed, so
switching tabs **never loses your place** (socket + last painted buffer survive), New Session included.

**A warm terminal belongs to a live pane, and a row must SAY it has one.** The mount gate asks for a
positive live report — unarchived and online — never for the absence of a dead state. That distinction is
the whole rule, because the console's list is the working sessions JOINED with the archive index, and an
archive-index row is a row *summary*: an id, a title, a `closedAt`, and no liveness, harness, or
capabilities at all. A gate phrased as "not offline" reads that **absence** as alive and mounts a terminal
plus a socket for every session the project ever retired — measured on this project's board, 66 of 76 warm
terminals and 66 of 76 sockets belonged to closed sessions, and their 4,290 never-painted row elements were
the whole of the console's return-to-tab cost ([[workspace-shell]]). The paired half keeps the surface
total: whatever has **no** live pane — archived, offline, `unknown`, headless — is shown as the
Conversation, so no selection can land on a session with neither layer mounted.

Hidden
pane-backed layers remain laid out at the final terminal geometry under `visibility:hidden`, keeping their xterm
and stable default renderer ready; switching changes visibility, not socket attachment or renderer identity. No pane loads a visibility-scoped WebGL addon,
so hidden sessions neither expose an empty replacement renderer nor accumulate capped GPU contexts. [[live-view]]
owns the matching backend rule: an unselected session, a closed Sessions route, or a background browser tab
owns no raw PTY or tmux geometry, while a visited hidden xterm keeps its cached pixels for an immediate return
paint. 
