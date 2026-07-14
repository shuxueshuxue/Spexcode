---
title: session-activity
status: active
hue: 260
desc: Each session row's headline IS the worker's own live one-line self-summary (its tmux pane title), overriding the launch-prompt placeholder; every list surface — the map-side window, the console sidebar, and the phone — renders the ONE compact one-line face (status folded to an inline colour-coded glyph, the word on hover); the map-side window alone keeps the avatar.
code:
  - spec-cli/src/selfSummary.test.ts
related:
  - spec-cli/src/sessions.ts
  - spec-dashboard/src/SessionWindow.jsx
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/SpecSearch.jsx
  - spec-dashboard/src/App.jsx
  - spec-dashboard/src/styles.css
---

# session-activity

## raw source

Each worker already narrates itself: Claude Code keeps its terminal title set to a short summary of the
task in front of it, updated every turn. That signal sits unused in tmux. Surface it on every session row
so a glance answers **what is each agent doing right now**, not merely *which* session this is — the way a
terminal tab renames itself to fit the work.

## expanded spec

**Capture (free, one call).** A self-narrating agent sets its terminal title via an OSC escape; tmux records
it as the **pane title** (never the window name — OSC titles don't touch it). Our worker runs one pane per
session named with the session id, so `listSessions` reads every pane title in a single `list-panes`
snapshot (`paneTitles`) — same shape and cost as the liveness snapshot — and, **only when this session's
harness declares its pane title to BE a self-summary**, hangs a cleaned summary (`paneActivity`) on
`Session.activity`. Whether a pane title is a self-summary is a **harness capability**
(`paneTitleIsSelfSummary`, on the harness adapter — the one branch, data not a scattered `if`): Claude Code
continuously writes its task summary into the title, so it qualifies; **Codex does not** — it sets the pane
title to a spinner glyph + the **cwd basename** (the worktree FOLDER name), so deriving a headline from it
would name the folder, not the task. For a non-self-summarizing harness `activity` stays `null` and the
headline falls through to the launch-prompt preview (below) — its task, never its folder. A genuine Claude
Code self-summary always **leads with a status glyph** (`✳` idle, a
braille spinner frame while working); that glyph is the **proof** the title is the agent's own OSC summary
and not tmux's default — which, from pane birth until the agent first speaks, is the **host name** (e.g.
`ser581555022561`), and the app may flash a bare splash before its first task. So the glyph is **required**:
a pane title without one is "not spoken yet" → `activity` is `null`, and the row keeps its launch-prompt
placeholder rather than flickering through the host name and splash. The glyph gate alone is not quite
enough: Claude Code also emits a **glyph-LED splash of its own app name** (`✳ Claude Code`) in the gap
between pane birth and its first real task summary — it clears the glyph gate yet is the app naming
*itself*, not the task, so it too is refused (a stripped summary equal to the bare app name → `null`) and
the row holds its launch-prompt placeholder rather than flashing "Claude Code" for a tick. Once present and
past those guards the glyph is stripped (the
dashboard draws its own status; a frozen spinner frame is noise) and only the summary text is kept. Activity
is **live and never persisted** — also `null` for any session that isn't up (offline / starting / queued),
so a dead or booting row never shows a stale line. A tmux hiccup drops the line for one tick, never the
session.

**Render (one shared face, two variants).** The shared session face ([[session-console]]'s `SessionRow`)
centres on the **headline** — the one best description of what this session is *about*, single-line with an
ellipsis. The headline prefers the worker's own live self-summary: once the pane title
exists, the agent-generated `activity` line **is** the headline — it tracks what the agent is doing *now*,
sharper than any launch-time label. Before it exists (booting / queued / offline) the headline shows the
first words of the launch prompt (`promptPreview`) as a **placeholder** that the smart label overrides the
moment it arrives, so the human's initial wording disappears once the agent has named its own task. A human
**rename (`name`) still wins** over both — the [[session-rename]] override stays authoritative everywhere.

There is ONE row face, and one thing flexes by surface: `showAvatar`. Every list surface — the two desktop
lists and the phone's ([[mobile-ui]]) — renders the **compact one-line** face: the headline followed by a
single colour-coded status **glyph** (`STATUS_GLYPH`, painted by `STATUS_COLOR`) rather than the word — the
exact word kept on the hover title for a11y — grouped into the three triage zones ([[session-console]]).
The **map-side** board window (SessionWindow) **keeps** the avatar, the
fixed spatial anchor that lets a session be **cross-referenced against the avatars on the very nodes it
edits**; the **console sidebar and the phone drop it** (`showAvatar={false}`, redundant beside the headline).
Where the avatar is gone the fixed anchor is simply the row's **slot** in the ordered
list, so the headline still renarrates each turn without the row losing its place. (An older **two-row**
variant — status word + op tally on a second line — lived on as the mobile list's face long after both
desktop lists folded it into the glyph; it is retired, deleted with its `compact` prop rather than kept as
a dead second implementation.)

The compact single line is a **resting** state, not a hard clip. Widening the whole sidebar to fit long
headlines is the wrong lever — it buys a few more characters for every row at the cost of the terminal
beside it, and still ellipses the long ones. So the width stays **narrow** (the list is a dense index,
not the place a title lives) and full length is bought **on demand, on the row you SELECT**: clicking a
session un-truncates its headline — it wraps to the full text in place — so any title is completely readable
without widening the list. Reveal is tied to **selection, not hover**: a hover-expand would grow the row
under the cursor and shove the rows below it down, turning every click into a moving target; only the row you
have already committed to opens, so the list stays a **stable click surface**. When the headline wraps, the
small **markers** (the status glyph, the op tally) stay pinned to its **first line's top-right** — they leave
the row's flow rather than reserving a column down every line, so the wrapped lines beneath run the **full
width**. That wrapped-reveal float is the only remaining job of `.sess-meta`'s full-width base rule; the
meta line stays the parking spot for any further at-a-glance metadata added later.

**The console repeats no headline over the terminal.** The Enter interface names the session ONCE, in its
left **sidebar** — the selected row, untruncated ([[session-console]]) — and the slim strip over the
terminal's top edge carries only the tabs and the lifecycle actions. The strip used to render the shared
`sessionHeadline` (`si-th-name`), but a bar that reads the sidebar's own line back at it, awkwardly
anchored between tabs and actions, identified nothing the sidebar didn't already — so it was dropped, and
"one name, every surface" is honoured by the sidebar row alone: the headline that renarrates the board row
renarrates the console's row in lock-step, and no console surface ever *disagrees* with it, because none
repeats it.

**One name, every surface.** The `sessionHeadline` is a session's display name *everywhere a human reads
which session this is* — rows, window, the console sidebar, **the search palette, the
lock-hint banner, and the [[node-menu]] overlay list** (right-clicking a node lists its live sessions —
the same live line the board rows show, never the stable label beside it) all show the identical line, so
wherever a session is named it reads the same. (Pinning any of them to the stable handle bought nothing —
the ordered slot, and the avatar where it's shown, are the fixed anchor and a rename already wins — and
cost a surface that named a session differently from its own board.) The stable
`sessionHandle` survives ONLY as a fixed-identity *reveal*, never a one-line title: the avatar/hover
**tooltips** and mobile's handle-line. Even
the [[session-rename]] prompt — where you edit the `name` override — titles itself with the headline the row
shows, not this handle, so it never names the session differently from the row it was opened from; its input
still prefills with the raw `name` override. Search still *matches* the handle even when it no longer
*shows* it, so finding a session by node/branch/id keeps working. That the door is *named* `sessionHandle`,
not `sessionName`, is what keeps this guarantee from eroding again — a new pick-list can't grab the stable
label by reflex ([[session-label]]).

This node's slice of the shared `styles.css` is the status line (`.sess-meta`, the full-width dimmer wrap)
and its compact-variant collapse (the `.si-item` one-line overrides that fold `.sess-meta` inline and drop
the status word for the `.sess-glyph` mark), and the Row-1 headline ellipsis; classes other
surfaces add there — like the eval tab's `.eval-*` verdict/transcript rules from the measure-and-score
reframe, or the console list's own compact-face overrides ([[session-console]]) — are those features' churn,
not session-activity's drift.
