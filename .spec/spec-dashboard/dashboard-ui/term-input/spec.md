---
title: term-input
status: active
session: sess-cmdline
hue: 290
desc: The command line lives outside xterm, so the arrow keys are ours.
code:
  - spec-dashboard/src/TermPane.jsx
  - spec-dashboard/src/NodeView.jsx
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/styles.css
---
# term-input

The terminal in the work pane is for *driving* the session — but xterm swallows
every keystroke, including the arrows we navigate the tree with. So opening the
work pane meant losing ←/→ node-toggling to the terminal.

Lift the command line *out* of xterm. The terminal becomes a read-only display
(capture-pane output); a separate input below it mimics the prompt and echoes
commands back into the display on Enter. Because the input is ours, the arrows are
ours too: when the line is **empty**, ←/→ walk parent/child and ↑/↓ walk siblings
(the same `onNav` the graph uses), so you toggle between nodes' specs + terminals
without ever leaving the work pane. With text on the line, the arrows edit it as
usual — empty is the signal that an arrow means "navigate", not "move the cursor".
