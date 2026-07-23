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
  - spec-dashboard/test/terminal-input.e2e.mjs
---

# terminal-input

A live session opens focused in its **real TUI**. Selecting a session, reselecting its active row, choosing
the Terminal tab, or returning from [[command-box]] explicitly activates that TUI and restores its focus.
Pointer activation must not blur xterm's hidden textarea before the activation lands: an in-progress browser
IME composition remains attached to the same input element instead of being ended by dashboard chrome.

xterm owns ordinary keyboard input and its hidden textarea owns browser IME composition; SpexCode does not
translate DOM keydowns into a second vocabulary. Consecutive composition commits are independent: a new
Chinese/Japanese/Korean candidate can never reuse or replace itself with the prior committed candidate. xterm's
ordered `onData` bytes travel on the terminal WebSocket to the visible viewer's one [[live-view]] helper,
which writes them to that same native tmux client's PTY. Rendering, resize, wheel navigation, and input are
therefore four messages on one terminal relationship, not separate approximations of the terminal.

Only the visible, live viewer may write. Hidden or disconnected browsers never queue keystrokes for replay,
and an input message from a stale viewer is ignored. A transport loss remains visibly reconnecting and fails
loudly by withholding input until the socket is open; it never pretends a key landed. The helper bounds each
input message before writing it, while preserving the byte string and event order xterm produced.

Dashboard-global shortcuts are the narrow exception. The capture layer may consume its documented navigation
chords and the reserved Command Box chord before xterm sees them. The terminal adapter also encodes
Shift+Enter as `ESC CR`, the conventional modified-Enter sequence understood as a draft newline by both Codex
and Claude inside true tmux; composition Enter is never intercepted. Everything else, including arrows,
ordinary Enter, Escape, control sequences, paste, and composed Chinese/Japanese/Korean text, belongs to xterm
and the agent's own TUI by default. Opening [[command-box]] moves focus to its textarea; closing or successfully
sending from it returns focus to xterm. No type mode, raw-key batching, menu sniff, or private xterm focus
override exists.

Pointer input is native: mouse-report DECSETs from tmux and the pane TUI reach xterm untouched, and
xterm's own mouse-report mode converts clicks and wheel into the SGR reports a real terminal sends,
riding the same input path as keystrokes. Copy stays a local affordance — selection follows the
universal mouse-owning-terminal convention (Shift-drag, Option-drag on macOS) and ⌘/Ctrl+C copies it;
paste remains xterm's native bracketed paste.
