---
title: keyboard-service
status: active
hue: 215
desc: One shell-owned capture listener that arbitrates overlays, active-view keys, and window-global shortcuts.
code:
  - spec-dashboard/src/KeyboardService.jsx#KeyboardServiceProvider
related:
  - spec-dashboard/src/Shell.jsx
  - spec-dashboard/src/workspace.jsx
  - spec-dashboard/src/keymap.js
  - spec-dashboard/src/bindings.js
  - spec-dashboard/src/GraphView.jsx
  - spec-dashboard/src/NodeView.jsx
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/TabStrip.jsx
  - spec-dashboard/src/SideBar.jsx
  - spec-dashboard/src/ContextDock.jsx
  - spec-dashboard/src/Dock.jsx
  - spec-dashboard/src/Settings.jsx
  - spec-dashboard/src/SpecSearch.jsx
  - spec-dashboard/src/i18n/en.js
  - spec-dashboard/src/i18n/zh.js
---
# keyboard-service

The desktop shell owns one window capture-phase keyboard service. It is mounted with the shell, so its
global vocabulary remains alive while the routed content changes. No destination view installs its own
window-level keyboard listener for a key that belongs to the shell.

## audit before the service

The table below is the complete `keymap.js` registry crossed with the routed desktop views. `fire` means the
physical key reaches a handler that performs the action; `-` means no action (the browser or the view's own
controls may still receive it). `graph*` includes the graph-only public face where noted. This is the
pre-refactor state measured from the source and spot-checked in Chromium against the running dashboard.

| registry action | graph | spec / file | sessions | evals | issues | settings | empty |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `nav.up`, `nav.down`, `nav.parent`, `nav.child` | fire; Shift passes through popup lens | - | - | - | - | - | - |
| `graph.zoomIn`, `graph.zoomOut`, `graph.zoomReset` | fire | - | - | - | - | - | - |
| `graph.info` (`i` / Enter) | fire; popup owns Enter as inert | - | - | - | - | - | - |
| `graph.search` (`/`) | fire; node palette | - | - | - | - | - | - |
| `graph.cycle`, `graph.cycleRev` | fire | - | - | - | - | - | - |
| `graph.fresh` (`[`) | fire; new-session route | - | - | - | - | - | - |
| `graph.evals` (`f`) | fire; evals route | - | - | - | - | - | - |
| `graph.newChild`, `graph.del` chords | fire | - | - | - | - | - | - |
| `graph.settings` (`,`) | fire to settings; settings-page toggle is dead | - | - | - | - | - | - |
| `graph.help` (`?`) | fire; graph legend | - | - | - | - | - | - |

The shell-level vocabulary was present only inside `GraphView`'s mounted effect, despite [[side-nav]]
declaring it window-global. Therefore `Alt+1..5`, `Alt+N`, `Alt+F`, `Alt+/`, and the global slash/search
door were absent on every non-graph route. The sessions page had a second capture listener that deliberately
returned reserved Alt page keys to the absent parent; this confirms the intended ownership but did not make
the keys work. Settings' shortcut-capture listener only exists while a binding is being edited and is not a
page router.

Browser spot-check (Chromium, pre-refactor dashboard at `http://127.0.0.1:5199`): on `#/spec/spexcode`,
`Alt+1` left the hash `#/spec/spexcode` and `/` left it unchanged with no dialog; on `#/graph`, `Alt+2`
changed the hash to `#/sessions` and `/` opened one search dialog. Evidence is recorded in
`/home/jeffry/spexcode-evidence/ded4-plan/before-spec-global-keys.png` and
`before-graph-search.png`.

## ownership and dispatch

The service resolves each `KeyboardEvent` through one ordered ownership chain:

1. The top overlay/palette/true modal owns the event and swallows it. Escape peels the existing LIFO escape
   layer first; the node-info popup remains a lens, so Shift+relationship navigation is passed to the active
   view while its unmodified pane/scroll grammar stays local.
2. The **SHOWING** view may register a key-owner. Being mounted is not the condition and stopped being a
   usable one the day documents outlived their turn on screen ([[workspace-shell]]'s mounted-document
   pool): a mounted scope is a claim on every keystroke, so a hidden graph would go on answering `j`/`k`
   while the reader typed into the spec beside it. A pane that is not showing registers nothing at all, and
   a view rendered outside any pane — the phone, the hub, the cold review entry, the sealed build — is its
   window's only view and always registers. Registration returns an unregister function and
   is idempotent; unmounting or being hidden gives the key-owner back to the service. Graph registers relationship walking,
   zoom/cycle, chords, the node popup lens, and its legend. Other views retain their own inputs and review
   navigation without claiming shell shortcuts.
3. The shell handles window-global actions: `Alt+1..4` ([[side-nav]]'s rail order), `Alt+N`, `Alt+F`, `Alt+/`, explorer dock visibility,
   dock mode, context dock visibility, tab close/next/previous, and sending the active tab to the split pane.
   These actions use existing workspace/route/tab APIs, so there is no second navigation model.

The service is the only window capture listener for these layers. Native controls and Ctrl/Meta browser
accelerators pass through unless the declared Alt family matches. The registry remains the only declaration
table (`id`, `keys`, `rebind`, `desc`); `bindings.js` continues to resolve user overrides for dispatch, for the
help legend and settings editor, and for the shortcut hint a tooltip prints, preserving [[keyboard-nav]]'s
one-registry/N-readers invariant. Every chord a surface reserves is declared in that table — a chord matched
inline in a handler's own body is invisible to the other readers and cannot be rendered or rebound.

## tab grammar

The tab commands are new registry entries with non-browser-reserved defaults: close the active tab, select
the next tab, select the previous tab, and send the active tab to the split pane. They must not steal
Ctrl/Meta accelerators. The service calls the existing `useTabs` and workspace APIs, so closing the last tab
still lands on the explicit empty address and split remains window state as required by [[tab-strip]] and
[[workspace-shell]]. All labels and shortcut descriptions are present in both English and Chinese.

**The typing restraint survives the hoist.** The shell scope inherits [[keyboard-nav]]'s native-control
clause: while DOM focus sits in a typing context (input, textarea, contenteditable — the session composer
and xterm's helper textarea above all), every unmodified key belongs to that control and the shell scope
returns unconsumed before matching any plain-key verb. The first build without this line sent a bare comma
typed into the composer to the settings page.
