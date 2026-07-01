---
title: session-activity
status: active
hue: 260
desc: Each session row's headline IS the worker's own live one-line self-summary (its tmux pane title), overriding the launch-prompt placeholder; the status + op tally ride a quieter second line on the map-side face, or fold to a single inline status glyph on the console's compact terminal sidebar.
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
placeholder rather than flickering through the host name and splash. Once present the glyph is stripped (the
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

Two things flex by surface, through the face's `compact` and `showAvatar` props. Both **desktop list
surfaces** are the **compact one-line** face (`compact`): the headline followed by a single colour-coded
status **glyph** (`STATUS_GLYPH`, painted by `STATUS_COLOR`) rather than the word — the exact word kept on
the hover title for a11y — grouped into the three triage zones ([[session-console]]). They differ only in the
**avatar**: the **map-side** board window (SessionWindow) **keeps** it, the
fixed spatial anchor that lets a session be **cross-referenced against the avatars on the very nodes it
edits**; the **console's own sidebar drops it** (`showAvatar={false}`, redundant beside the headline in its
dense list). Where the avatar is gone the fixed anchor is simply the row's **slot** in the ordered
list, so the headline still renarrates each turn without the row losing its place.

The compact single line is a **resting** state, not a hard clip. Widening the whole sidebar to fit long
headlines is the wrong lever — it buys a few more characters for every row at the cost of the terminal
beside it, and still ellipses the long ones. So the width stays **narrow** (the list is a dense index,
not the place a title lives) and full length is bought **on demand, per row**: in the console's own sidebar
the row you **point at or have selected** un-truncates — its headline wraps to the full text and the row
grows downward — so any title is completely readable without a hover-tooltip delay and without stealing a
pixel from the pane beside it. The row you are pointed at keeps its top edge, so reading a title never
shifts it out from under the cursor. The **mobile list** alone keeps the older **two-row** face, its status
on a second line, described next.

The two-row variant's **status line** is the small state badges moved off the headline: the colour-coded
status **word** and the op tally (how many spec nodes this session is changing, e.g. `~2`), in a smaller,
dimmer font spanning the **whole row width** (the flex row wraps and the line takes a full-width basis, so it
drops below the avatar too). It is the parking spot for any further at-a-glance metadata we add later. When
this row is the **locked** selection a 🔒 sits at the end of Row 1, and the status word **stays** below
(locking no longer hides it). This two-row face is now the **mobile** list's; both desktop lists fold the
same status onto their single compact row as its glyph.

**The console action strip reads the same headline.** The Enter interface's **slim action strip** over the
terminal's top edge ([[session-console]]'s `si-th-name`) renders the SAME `sessionHeadline`, not the stable
node name — so the agent's live self-summary that renarrates the rows renarrates it in lock-step, and the
headline over the terminal never disagrees with the row that opened it. The data source and the content are one
shared line across both surfaces; the **only** difference is room: the strip is a wide bar, so it gives the
headline `flex:1` of that width and ellipsises far **later** than the compact rows — less truncation where
there is space for more.

**One name, every surface.** The `sessionHeadline` is a session's display name *everywhere a human reads
which session this is* — rows, window, Enter tabs, console action strip, and now **the search palette and the
lock-hint banner** show the identical line, so where a session is searched from and where it is found never
disagree. (Pinning those two to the stable `sessionName` bought nothing — the ordered slot, and the avatar
where it's shown, are the fixed anchor and a rename already wins — and cost a palette that named a session differently from its own board.) The stable
`sessionName` survives ONLY as a fixed-identity *reveal*, never a title: the avatar/hover **tooltips**. Even
the [[session-rename]] prompt — where you edit the `name` override — titles itself with the headline the row
shows, not this handle, so it never names the session differently from the row it was opened from; its input
still prefills with the raw `name` override. Search still *matches* the handle even when it no longer
*shows* it, so finding a session by node/branch/id keeps working.

This node's slice of the shared `styles.css` is the status line (`.sess-meta`, the full-width dimmer wrap)
and its compact-variant collapse (the `.si-item` one-line overrides that fold `.sess-meta` inline and drop
the status word for the `.sess-glyph` mark), the Row-1 headline ellipsis, and the console action strip's
headline room-to-expand (`.si-th-name`'s `flex:1` + ellipsis — the same headline, more width); classes other
surfaces add there — like the yatsu eval tab's `.eval-*` verdict/transcript rules from the measure-and-score
reframe, or the console list's own compact-face overrides ([[session-console]]) — are those features' churn,
not session-activity's drift.
