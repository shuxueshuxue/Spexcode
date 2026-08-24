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
  - spec-dashboard/src/readSafety.test.mjs
  - spec-dashboard/src/styles.css
  - spec-dashboard/test/terminal-input.e2e.mjs
  - spec-dashboard/test/terminal-chrome-focus.e2e.mjs
  - spec-dashboard/test/terminal-hscroll.e2e.mjs
---

# terminal-input

A live session opens attached to its **real TUI** and writable by default — typing is the basic terminal
operation, and the human should be able to do it immediately. Selecting or switching sessions is still a read:
it never resumes a stopped process, consumes a token, or replays a queued key. Archived/offline sessions have no
terminal pane and remain read-only Conversation surfaces. If a live TUI is in a suspended state that requires a
resume, the first actual key opens a separate confirmation; the key is held until confirmation, never pre-focuses
the confirm control or places it at the cursor landing, and cancel drops it. Returning from [[command-box]]
restores terminal focus without another unlock step.
The launch handoff is durable across the queue-to-live boundary: canonical lifecycle state may publish `active`
before the legacy JSON envelope is rewritten, but the envelope's queued lease remains readable until that
historical projection is retired. A live session must never be left offline merely because that lease was cleared
while the envelope still says `queued`.
Pointer activation must not blur xterm's hidden textarea before the activation lands: an in-progress browser
IME composition remains attached to the same input element instead of being ended by dashboard chrome.
Beyond activation, **console chrome is pointer-inert for focus**: clicking and operating the sidebar list,
zone headers, fold pods, the list resizer, the toolbar, or any other non-input chrome never takes focus
from the TUI — the console's panel-wide blanket cancels the press's focus move while the click still acts
(the same blanket protects whichever composer currently owns the surface). A transient pop above the
console that legitimately takes focus — the search palette, a modal — returns it to the TUI on exit
([[focus-return]] owns that boundary), so leaving any pop lands you typing again, never on dead chrome.

xterm owns ordinary keyboard input and its hidden textarea owns browser IME composition; SpexCode does not
translate DOM keydowns into a second vocabulary. Unmodified printable keys complete through the browser's
native text events instead of xterm eagerly translating their physical key code on `keydown`; the IME's
committed text therefore wins when the same comma or period key means `，` or `。`. Once xterm publishes an
ordinary `insertText`, its terminal-only helper value is cleared; sent keystrokes never accumulate invisibly
and displace the next composition. The pane also **never moves while you type**: xterm parks
that textarea at the cursor cell and widens it to the composition string, so at the rightmost columns the
focused box pokes past the pane edge — and the browser's caret-reveal will drag ANY scrollable ancestor
sideways to chase it, overflow:hidden included. The console's terminal chrome is therefore `overflow: clip`
(not a scroll container at all), so a right-edge composition finds nothing to scroll and the grid stays put. Consecutive composition commits are independent: a new
Chinese/Japanese/Korean candidate can never reuse or replace itself with the prior committed candidate. xterm's
ordered `onData` bytes travel on the terminal WebSocket to the visible viewer's one [[live-view]] helper,
which writes them to that same native tmux client's PTY. Rendering, resize, wheel navigation, and input are
therefore four messages on one terminal relationship, not separate approximations of the terminal.

Only the visible, live viewer may write. Hidden or disconnected browsers never queue keystrokes for replay,
and an input message from a stale viewer is ignored. A transport loss remains visibly reconnecting and fails
loudly by withholding input until the socket is open; it never pretends a key landed. The helper bounds each
input message before writing it, while preserving the byte string and event order xterm produced.

The input boundary is insensitive to browser event framing. xterm may coalesce a focus report or a mouse
button report with a real key byte, so filtering must remove those control reports from a mixed payload rather
than recognizing only a payload that consists of one report. Non-wheel pointer reports and focus reports are
discarded; wheel reports remain native tmux navigation, and every remaining byte keeps its original order.

When a suspended pane receives a coalesced payload, the confirmation gate examines the payload after all
pointer and focus reports are removed. Only remaining real bytes become pending input; a pointer report
cannot bypass confirmation merely because it shared a frame with a key.

Dashboard-global shortcuts are the narrow exception. The capture layer may consume its documented navigation
chords and the reserved Command Box chord before xterm sees them. The terminal adapter also encodes
Shift+Enter as `ESC CR`, the conventional modified-Enter sequence understood as a draft newline by both Codex
and Claude inside true tmux; composition Enter is never intercepted. Everything else, including arrows,
ordinary Enter, Escape, control sequences, paste, and composed Chinese/Japanese/Korean text, belongs to xterm
and the agent's own TUI by default. Opening [[command-box]] moves focus to its textarea; closing or successfully
sending from it returns focus to xterm. No type mode, raw-key batching, menu sniff, or private xterm focus
override exists.

The pointer is the browser's and never the application's. Plain drag always makes a local xterm
selection (the patched selection predicate diverts every button event from mouse reporting), ⌘/Ctrl+C
copies it, and paste remains xterm's native bracketed paste — no modifier is ever required. While a
terminal selection exists the copy chord is consumed **before** xterm's own key handling (it must never
fall through as `\x03`/SIGINT into the application), and it stands down only for a **real composer
field's** own selection — the helper textarea's mirrored selection *is* the terminal's, never a
stand-down reason. Without a selection the chord stays the terminal's ordinary interrupt. Motion
tracking is filtered at the adapter so hovering emits nothing; only wheel reports leave the browser,
routed by tmux's native bindings ([[live-view]] owns that contract). Every xterm mouse report format
(SGR, X10, and URXVT) is pointer traffic at the input boundary, never the first resume key.
