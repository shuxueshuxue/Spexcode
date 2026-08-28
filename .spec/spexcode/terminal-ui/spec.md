---
title: terminal-ui
status: active
hue: 280
desc: The published dark terminal React component with one injectable transport seam, xterm 6 synchronized-resize patch, and host-fallback tokens.
code:
  - packages/terminal-ui/src/index.ts
related:
  - packages/terminal-ui/package.json
  - packages/terminal-ui/styles.css
  - packages/terminal-ui/scripts/patch-xterm-sync-resize.mjs
  - spec-dashboard/src/SessionTerm.jsx
  - .spec/spexcode/spec-dashboard/dashboard-ui/session-console/terminal-io/terminal-input/spec.md
  - .spec/spexcode/spec-cli/sessions/live-view/spec.md
---
# terminal-ui

`@spexcode/terminal-ui` is the reusable terminal grammar extracted from SpexCode's dashboard. It owns the
xterm host, synchronized output and resize transaction, pointer/input filtering, copy and resume confirmation,
focus and visibility lifecycle, and the dark terminal visual surface. React is a peer (`^18 || ^19`), Node is
18+, and the package pins `@xterm/xterm` 6.0.0 with `@xterm/addon-fit` 0.11.0.

The host supplies exactly one transport seam: `connect(id) -> { send, resize, onData, close }`. The package
does not know WebSocket URLs, sessions APIs, i18n, or dashboard state. SpexCode's dashboard binding adapts its
resilient socket and supplies labels and font preferences; another host can provide another transport.

The package stylesheet uses `--tt-*` tokens with a fallback chain to the dashboard's existing `--term-*`, shared
tokens, and dark defaults. The terminal background remains dark in every host theme. There is no emoji or icon
font. Package tests render through `react-dom/server`; dashboard end-to-end scenarios prove the binding.

The xterm correction is version-locked and fail-loud. Package build and dashboard `predev`/`prebuild` invoke the
same patch beside this package. A pristine install is intentionally unpatched until one of those build entries
runs; an unexpected version or source shape aborts the build instead of serving an unpatched terminal.
