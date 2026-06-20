---
title: term-input
status: active
session: sess-cmdline
hue: 290
desc: The command line lives outside xterm, so the arrow keys are ours.
---
# term-input

## raw source

A terminal is for *driving* a session, but xterm swallows every keystroke — including the arrows we
navigate the tree with. So the command line must live **outside** xterm: the terminal is a read-only
display, and a separate input owns the keys. Because the input is ours, an arrow can mean "navigate" when
the line is empty and "edit" when it isn't — empty is the signal. The same ownership lets an input wear
**completion menus** keyed off the first character — and `@` and `/` answer **different questions**, so a
row only ever inserts its token text (`@<id> ` / `/<name> `), never runs anything. The **New Session**
prompt wears **both**: `@` lists spec nodes (which node does this new session target?) and `/` lists the
**config presets** (its own bespoke command set — `tidy`/`health`/…, served by `GET /api/config`), *not*
Claude Code's palette. A **running session's `❯` inbox** instead wears the `/` menu that mirrors Claude
Code's own, because there you are talking *to a live agent* where CC `/`-commands make sense. The New
Session `/` is more than insertion: it **composes** at launch — `/tidy @a @b extra text` assembles ONE
prompt = the preset's `body` with its `{{targets}}` placeholder filled by the `@`-resolved nodes, then the
free text — but the dropdown itself stays decoupled (picking a preset only inserts `/<name> `).

## expanded spec

`TermPane` makes xterm a read-only display (`disableStdin`, capture-pane output) with our own `.term-input`
line below it that mimics the prompt and echoes commands into the display on Enter. The arrow fall-through
is the point: when the line is **empty**, `←`/`→` walk parent/child and `↑`/`↓` walk the column (the same
`onNav` the graph uses, see [[keyboard-nav]]), so you toggle between nodes without leaving the pane; with
text present the arrows edit the line and stop bubbling so nothing double-fires. The principle is
transport-agnostic — wherever a live terminal sits beside spec navigation, the input stays outside xterm.

`TermPane.jsx` still implements that pattern verbatim — read-only xterm + external `.term-input`, the
empty-line `NAV` map calling `onNav` — and its CSS (`.pane-term` / `.term-host` / `.term-input` /
`.term-line`) still lives in `styles.css`, but it is **no longer mounted**: the work pane that hosted it was
removed from `NodeView.jsx`, whose popup is now a reference-only view (tabs `spec` / `recent` / `history`,
no terminal, no keyboard special-case — see [[work-pane]]). The live-terminal-with-external-input idea was
re-realised in the session interface ([[session-console]]): `SessionTerm` streams the real tmux pane
(read-only xterm over one WebSocket) and a docked input dispatches the message through the rendezvous
**control socket** (`POST /api/sessions/:id/keys`, which injects via the daemon socket, **bypassing tmux**)
— **never** by writing the line into the pane. That distinction is load-bearing: scrolling the terminal
puts tmux in **copy-mode**, where any bytes written into the pane are eaten as copy-mode navigation and
never reach the agent; dispatching out-of-band lands the message regardless of scroll/copy-mode state. The
WebSocket the terminal holds is **display + scroll only** (it carries the read-only pane stream down and,
back up, *only* the synthetic wheel→copy-mode scroll reports). Dispatch is fail-loud: `/keys` 502s when it
can't deliver, and the input surfaces that (restores the draft, flags the error) rather than pretend it
sent. List nav is lifted to the **window** level so arrows survive xterm focus — the same "keys are ours,
not xterm's" guarantee, now over a real pane instead of a mock. `App.jsx`'s capture-phase listener still enforces that
arrows belong to navigation while a modal owns the keys. So `TermPane.jsx` stands as the original in-popup
realisation, presently dormant, while the contract lives on over a real session pane — the realisation moved
surfaces, the principle (input outside xterm so arrows can navigate) did not.

The `/` command palette is the same idea, one rung up: a leading `/` on a **running session's `❯` inbox**
opens a dropdown that **mirrors Claude Code's `/` menu** for this CC version, because `/`-commands address a
live agent, which is exactly what that box talks to. The inbox is docked at the bottom of the
panel, so the dropdown opens **upward**, above the box.

The **New Session** box wears its own `/` palette — the **config presets** (`GET /api/config` → the
skill-shaped preset nodes under `.spec/spexcode/config/*`, each `{name, desc, kind, body}`), *not* the CC
command set. It reuses the same dropdown shell and trigger as the inbox `/` (whole-line `/token`, no space
yet; the row's right-hand tag is the preset's `kind` — `mutating`/`report`). The payoff is **composition at
launch**: the grammar `/<preset> @<node>… <free text>` assembles ONE prompt — the preset's `body` with its
`{{targets}}` placeholder replaced by the `@`-resolved nodes (each kept as `@id — path`, so the server still
derives the session's node from the first `@id`), then the human's free text appended. No `@` leaves a
"current/focused node" note for the body to handle. A leading `/` that names no known preset, and any plain
or `@`-only prompt, launch verbatim — the existing paths are untouched. The dropdown stays decoupled:
picking a preset only inserts `/<name> `; the body is woven in only when **Enter** launches the session. Its rows are the union of CC's
**built-in** commands (a seed constant captured from a live `claude` `/` menu, so it is refreshable per
version), the **user** commands under `~/.claude/commands/**` and **project** commands under
`<repo>/.claude/commands/**` (name = path under `commands/` minus `.md`, subdirs namespaced `a:b`,
description from `description:` frontmatter else the first body line), plus **skills** best-effort — each
row carrying a source tag (`(user)`/`(project)`/`[skill]`/built-in). The backend computes that union the
same way CC does and serves it at `GET /api/slash-commands` ([[spec-cli]]); the input filters by the typed
prefix and reuses the @-mention's keyboard machinery (↑/↓ move, ⏎/⇥ insert, Esc dismiss, prefix-bold). The
contract's hard edge is that it is **decoupled**: the sole effect of choosing a row is inserting `/<name> `
into the box — no execution, no dispatch, no other behavior — so it is a navigational/authoring aid, never
a second control plane over the session.

Because the principle is realised in files other nodes own, this node governs **no source of its own**: the
dormant in-popup original `TermPane.jsx` is owned by [[session-peek]] (whose sole concern *is* that embed),
the live realisation (`SessionTerm` + docked input) by [[session-console]], and the capture-phase arrow
routing in `App.jsx` by [[keyboard-nav]]. The `/`-palettes and `@`-mention completions live the same way:
their UI sits in `SessionInterface.jsx` (owned by [[session-console]]); the CC command union is computed in
`slash-commands.ts` and the config presets in `specs.ts`/`loadConfig` (both [[spec-cli]], served at
`/api/slash-commands` and `/api/config`). Listing none of them here is the point — term-input is the
cross-cutting *contract*, and a change to any of those surfaces is that surface's drift, not a phantom
warning on this principle.
