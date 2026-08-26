---
title: new-session-tab
status: active
hue: 280
desc: The console's New Session tab — a launch composer with the `/<preset> [[node]]… <free text>` grammar, background fire that never disables the box, and the launcher pop-out picker as the only launch choice.
code:
  - spec-dashboard/src/SessionInterface.jsx#LauncherPicker
related:
  - spec-dashboard/src/launch.js
  - spec-dashboard/src/Composer.jsx
  - spec-dashboard/test/session-command-preset.e2e.mjs
---

# new-session-tab

The quietest surface in the [[session-console]]: one long-form prompt under the [[launch-hero]] wordmark, a launcher
picker beneath it, and nothing else. This node owns the tab's grammar, focus discipline, and background fire; the
launch itself is [[launch]]'s and the picker's data is [[launcher-select]]'s.

**New Session** is a centred splash — the [[launch-hero]] block-letter wordmark — over an auto-growing
input. Like every dashboard-authored composer, it uses [[composer]]'s `ComposerTextarea`, whose one
`fitTextarea` measurement path grows through each content line without a scrollbar until the host's
declared cap. Composer keyboard meaning is deliberately split by product action: a **message** composer
(TimelineChat conversation or Command Box) sends on plain Enter, inserts a line on Shift+Enter, and never
sends the Enter that commits an IME composition; a **launch** composer (this New tab or the phone's Create
screen) follows the same plain-Enter submit and Shift+Enter newline grammar, while its explicit launch button
remains available as the pointer path. Nothing is prefilled; typing **`[[`** opens the
node dropdown (the focused node leads it) — a topic reference ([[mentions]]). A **`/query` token at the
caret**, at the draft's start or after whitespace, opens the config-preset palette even when the draft already
contains prose; accepting it promotes the chosen `/<preset>` to the draft's start and preserves that prose.
The two compose the launch grammar `/<preset> [[node]]… <free text>`, from which the server derives the node
(the first `[[<id>]]`). Both menus only edit text; the New prompt has **no** `/` slash-command menu (presets
only). A preset launched with **no node target** never assumes a node — the agent takes scope from the prompt,
else asks first.
**Submitting launches and opens the new document**: the prompt clears **immediately** and **focus stays in the box** —
the box **never disables or blurs**; the launch fires in the **background**, so the box is type-ready at once and you
can fire off several in a row **without waiting** for each launch's worktree+agent setup (seconds of real work) to
finish. Disabling the box for the whole in-flight window was the bug: on a slow or remote launch the entire pane sat
greyed and unfocused until the POST *and* a board re-read returned. The pending document remains selected while the
immediate board refresh (else the next poll) surfaces its full row. Creation is the one deliberate selection change;
after that, only a tab's *removal* (below) moves your selection for you. Once the create response publishes an id, the
current slot navigates to `#/sessions/<id>`; a `queued`/`starting` row keeps the stable
session name and shows the shared tab spinner while creation readiness catches up.

Beneath the box a launcher **pop-out picker** is the ONLY launch choice ([[launcher-select]]). A
launcher names both the harness ([[harness-adapter]] — Claude vs Codex) and the command/auth profile, so the
launch `POST /api/sessions` carries only `launcher`; the backend derives `harness` from that selected profile.
The picker is a clean pill **button** wearing the selected launcher's harness vendor mark + name — no caret,
no label; its tooltip points at `spexcode.json` / `spexcode.local.json` as the one place launchers change.
It opens a **centred pop-out card** — a viewport-centred dialog over a light backdrop, deliberately
not an anchored dropdown — with **one row per dashboard-visible launcher** ([[launcher-visibility]]) (the row's
harness glyph + name, the selected row marked), and beneath each name the profile's configured command
**in full, as inert read-only text** (selectable for copying, but not a control — nothing in the card is
clickable except the row select itself; no chevron buttons, no edit surface: config files remain the
sole place a `cmd` is written). Selecting a row closes the pop;
a backdrop click or Esc closes it too. Seeded interactive launchers keep the picker present in an initialized
project, and configured dashboard-visible profiles add more names. The launcher pick is
**remembered** (per-browser), honors the backend's configured default when there is no remembered valid pick,
never assumes a node, and composes orthogonally with the `/<preset> [[node]]… text` grammar above.
The launch **substance** — that grammar's composition, the launcher fetch/default/remembered-pick, and the
one `POST /api/sessions` — is shared with the phone's composer ([[mobile-ui]]): both send the raw grammar
through `launch.js`, while [[launch]]'s backend owner performs the command-plugin invocation for every caller,
including CLI and direct API use. This tab owns only the desktop chrome around it (menus, focus discipline,
background fire) and never expands a plugin body itself.
