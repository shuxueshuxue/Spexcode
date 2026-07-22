---
title: terminal-input
status: active
hue: 280
desc: The live xterm is the default input surface: browser-native keyboard and IME data flow into the same visible tmux client that renders the pane.
code:
  - spec-dashboard/src/SessionTerm.jsx
related:
  - spec-cli/src/pty-bridge.ts
  - spec-cli/src/pty-helper.mjs
  - spec-cli/src/index.ts
  - spec-dashboard/src/SessionInterface.jsx
---

# terminal-input

A live session opens focused in its **real TUI**. xterm owns ordinary keyboard input and its hidden textarea
owns browser IME composition; SpexCode does not translate DOM keydowns into a second vocabulary. xterm's
ordered `onData` bytes travel on the terminal WebSocket to the visible viewer's one [[live-view]] helper,
which writes them to that same native tmux client's PTY. Rendering, resize, wheel navigation, and input are
therefore four messages on one terminal relationship, not separate approximations of the terminal.

Only the visible, live viewer may write. Hidden or disconnected browsers never queue keystrokes for replay,
and an input message from a stale viewer is ignored. A transport loss remains visibly reconnecting and fails
loudly by withholding input until the socket is open; it never pretends a key landed. The helper bounds each
input message before writing it, while preserving the byte string and event order xterm produced.

Dashboard-global shortcuts are the narrow exception. The capture layer may consume its documented navigation
chords and the reserved Command Box chord before xterm sees them. Everything else, including arrows, Enter,
Escape, control sequences, paste, and composed Chinese/Japanese/Korean text, belongs to xterm and the agent's
own TUI by default. Opening [[command-box]] moves focus to its textarea; closing or successfully sending from
it returns focus to xterm. No type mode, raw-key batching, menu sniff, or private xterm focus override exists.

Pointer selection and copy remain local browser affordances. Mouse-report mode toggles are still consumed at
the adapter boundary so drag selection stays uninterrupted, while wheel messages continue through tmux's real
navigation path.
