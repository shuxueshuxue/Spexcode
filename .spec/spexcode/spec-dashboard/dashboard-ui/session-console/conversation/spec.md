---
title: conversation
status: active
hue: 280
desc: The terminal-free session surface — one shared Conversation DOM for every existing session, with a footer whose data states cover live, offline, archived and retired; folded status rows; a floating composer that always replies via note; and a mount lifetime that survives deselection.
code:
  - spec-dashboard/src/TimelineChat.jsx
related:
  - spec-dashboard/src/RichText.js
  - spec-dashboard/src/Composer.jsx
  - spec-dashboard/test/timeline-chat-composer.e2e.mjs
  - spec-dashboard/test/session-surface-cold-readable.e2e.mjs
  - spec-dashboard/test/lifecycle-outcome.e2e.mjs
---

# conversation

Every existing session in the [[session-console]] — live, offline, archived, headless — renders the same
Conversation: one timeline body, one footer, one composer. Lifecycle changes what the footer says and whether the
composer is enabled; it never creates another right-pane face. [[rich-conversation]] owns how prose renders inside
it — with one decision declared HERE: a newline in the transcript was typed mid-conversation, so it stays a line
break rather than reflowing as an authoring wrap; [[message-stream]] owns the native execution trace this surface
deliberately does not drill into.

**Every existing session, including offline and archived
records, renders the same Conversation DOM: one shared timeline body and one shared footer (no surface tabs).**
For a live session that footer is only the enabled message composer. For an offline session it contains the
same disabled, non-focusable composer followed by `⏻ agent 已离线 · 内容只读` and the ordinary relaunch
action. For an archived session it contains that disabled composer followed by `▤ 已归档 · 内容只读`; its
archive restore action remains available. A `retired` record is the other legislated offline exception: it keeps
the `⚑` badge that says its worktree is gone and has no relaunch action. These are data states of one footer
component, not separate panels. The timeline remains
readable without restoring the agent; archived history is immutable and cannot receive later `sent` events, while
an offline record may still be written by an external `spex session send`, so archived is the only state that reads
once when selected and does not poll. A pane-backed offline or archived record remains Conversation and cannot
be switched to Terminal. `queued` and `archive` are the two legislated exceptions to the ordinary offline
projection: queued has intentionally not launched and self-starts as a slot frees, while archive is closed and
restored explicitly.

**THE TRANSCRIPT IS A CONVERSATION, NOT A LOG.** It used to render as nested containers — a tinted well, a
rule under every turn, a role word above each, a bordered box per tool — so reading it meant reading the
chrome. A chat carries its structure in the shapes of the turns themselves. The person is QUOTED: a narrow
bubble, capped well under the measure, one corner squared into a tail, sitting off to its own side. The
agent IS the page: full measure, no bubble, no tint. Boxing both would make an exchange read as a table of
two columns. The whole flow is held to a centred measure — without one, at a wide pane the bubble sat
against the right edge while the prose began at the far left, a thousand pixels away, and the two stopped
reading as one conversation.

**Collapse the process, keep the result.** Everything that produced an answer folds the moment the answer
exists; the answer itself, and anything durable, stays. The unit is the work SEGMENT — a consecutive run of
agent turns ending at the last one that actually says something — not a single turn's tool calls. That
distinction is measured, not assumed: a real session put 39 calls across 21 turns, one or two each, so a
fold scoped to one turn never fired and the reader still scrolled 21 blocks of work to reach one answer.
A folded segment states the count and the KINDS that ran and nothing else; naming the kinds is what lets a
reader decide whether to open, while repeating the count they just read is noise.

**A tool call is a SENTENCE, not a card**: a past-tense verb, its target, and the size of what came back,
`inline-flex` and bounded so a long shell command cannot stretch it into a full-width bar. Twelve of them
read as a list of things that happened; twelve boxes read as boxes. The verb is the whole status claim,
because the record carries no per-tool success, failure, or duration — a tick or a badge here would be
invented, and nothing is shown that was not measured. A tool whose name has no verb keeps its name; a row
that says nothing is worse than one naming a tool we have no word for. Grouping never infers what a call
DID: a shell command parsed as harmless could hide a write inside a fold, so runs gather by position and
are labelled by what is on the record.

Conversation status rows carry how long the session stayed in that state — the question scrollback actually
raises, with the status word beside it already saying which state — and expose one keyboard-reachable
disclosure button (`aria-expanded`) for each transcript entry. Every entry starts folded on first load, after a timeline/status refresh, and when a different session is selected; no data arrival or remount may open it. The disclosure choice is keyed to the status event, not to the current transcript interval, so a later status that closes the interval keeps an already-open entry open and keeps an untouched entry closed. The timeline body is selectable text: Conversation chrome does not cancel its pointer press, and rich prose/code preserves authored newlines and indentation through browser copy. Selection support must not rely on an overlay, `user-select: none`, or an accidental editable surface.

That conversation is the whole terminal-free console, with no [[message-stream]] native-event drill-down. 

**Both session surfaces frame their content identically.** The Conversation's composer FLOATS over its
reading column, the same shape Command Box already has on the terminal surface, and the timeline pads its
tail so the newest entry is never parked behind it. That is what makes the surface a property of the
content and not of the frame: choosing Terminal or Conversation changes what fills the document area, never
how many chrome rows sit around it, which is exactly the claim [[ui-state-model]]'s budget measures. The
composer's card IS its field — one frame, not an input bordered inside a bordered bar. TimelineChat's composer always sends `replyVia:"note"`: this is the fixed
terminal-free surface property, and the note data arrives because the agent executes the external
`spex session <verb> --note` CLI; hooks only prompt the agent at turn boundaries and carry no note data.
Session rows still carry only their status and activity vocabulary — no redundant mode badge.

TimelineChat's
message composer is the shared [[composer]] textarea and auto-growth path, with the same Enter / Shift+Enter /
IME-send boundary as Command Box; its docked mobile and desktop hosts do not invent a second textarea
mechanism.

A
pane-backed Conversation mounts only on its first visit, then remains mounted after deselection or going offline
so its timeline cursor and rendered history survive revisits; its refresh timer runs only while selected.
Headless sessions follow that same Conversation lifetime from their first selection. Unvisited Conversation
surfaces remain inert and make no timeline/detail reads or polling timers. 
