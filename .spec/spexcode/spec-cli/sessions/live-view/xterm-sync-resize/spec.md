---
title: xterm-sync-resize
status: active
hue: 280
desc: The dashboard pins xterm 6 and applies one fail-loud upstream-sized correction so an explicit grid resize obeys the same DEC 2026 rendering hold as terminal bytes.
code:
  - spec-dashboard/package.json
related:
  - spec-dashboard/package-lock.json
  - spec-dashboard/scripts/patch-xterm-sync-resize.mjs
  - spec-dashboard/src/SessionTerm.jsx
  - spec-dashboard/src/styles.test.mjs
---

# xterm-sync-resize

The browser terminal engine owns terminal parsing, buffer state, grid mutation, and DOM rendering. SpexCode
pins the first xterm release with DEC synchronized-output support. That release buffers row rendering while
mode 2026 is active but otherwise mutates the renderer immediately on an explicit API resize, exposing the old
buffer at the new grid before the synchronized native repaint.

Installation applies one version-locked correction inside that engine: a renderer resize joins the existing
deferred resize task while synchronized output is active, and the task flushes before buffered rows render
when the hold closes. The installer is exact and idempotent; an unexpected package version or source shape
fails installation instead of silently running without the invariant. Because a dependency reinstall can
recreate the engine without running install scripts, every build and dev entry re-runs the same idempotent
installer first — a production bundle or dev server cannot silently serve an unpatched engine; it is patched
or it fails loudly. The resize path uses only xterm's public
terminal API and carries no snapshot layer, replacement renderer, or private resize hook.

[[live-view]] owns the product transaction and its browser evidence. This node owns only the dependency
boundary that makes xterm honor that transaction.
