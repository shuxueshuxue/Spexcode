---
title: conversation
status: active
hue: 280
desc: The terminal-free session surface — one shared Conversation DOM for every existing session, with a footer whose data states cover live, offline, archived and retired; messages, seams and events on a time ruler rather than status rows; a floating composer that always replies via note; and a mount lifetime that survives deselection.
code:
  - spec-dashboard/src/TimelineChat.jsx
related:
  - spec-dashboard/src/RichText.js
  - spec-dashboard/src/conversationItems.js
  - spec-dashboard/src/Composer.jsx
  - spec-dashboard/test/timeline-chat-composer.e2e.mjs
  - spec-dashboard/test/session-surface-cold-readable.e2e.mjs
  - spec-dashboard/test/lifecycle-outcome.e2e.mjs
  - spec-dashboard/test/conversation-working-tail.e2e.mjs
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
two columns. The whole flow is held to ONE centred measure — `--conversation-measure`, 720px, the column the agent's
prose, the person's quotes and the composer all share — without one, at a wide pane the bubble sat
against the right edge while the prose began at the far left, a thousand pixels away, and the two stopped
reading as one conversation. The margins around that column grow with the pane (container units), so a
wide window reads as a sheet with generous edges and a narrow one keeps every pixel for the words.

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

**THE STATUS MACHINE IS NOT THE READING UNIT.** The timeline the backend records is the machine's trace —
`working` ↔ `asking` ↔ `working` … — and rendering every event as a row (a head with glyph, word, duration
and time, then a disclosure line) made a real session show 26 bare `working` rows spending two lines of
chrome each, `working 1s → 11s → 4m 30s` stacked as three rows, a toggle at the far right whose content
opened at the far left, the agent's report set as a blockquote though it is the page, and a terminal
`error 80h 45m` that read as eighty hours of failing. A reader reads three things, and the page shows
exactly those three:

- A MESSAGE is anything said. The agent's note IS the page: no well, no rule, no indent, at the prose size
  (`--type-prose`, the one token this surface added) running the full measure, with one small status chip
  above it (`? asking`, `‖ parked`, `✓ done`) in the caption voice at medium weight as the machine's whole
  footprint. A sent message and the originating prompt are QUOTED: a soft sheet on the right — a quieter
  tint than a panel, the radius token doubled because it is a page element and not a control — capped at
  80% of the measure, in the same grammar as the transcript's person turn, so the outer conversation and
  the inner one read alike. A peer's name sits on its bubble; the
  human's has none. The addressing envelope `spex session send` appends (`— from session … To reply: …`) is
  never rendered — the record keeps it, the surface strips it. A long quote is clamped at first sight with
  a `more`, because the conversation is about what came after it.
- A SEAM is a stretch in which the agent said nothing and worked — opened by a bare `working` event, or by
  any message or note that landed on an agent whose last recorded word is `working`, since the record does
  not say `working` again ([[conversation-items]] carries that state; a working record therefore always
  ends in an open seam, and a message sent mid-turn is followed by one). It is one quiet line in the caption
  voice, `worked 13m 17s ›`, whose duration is how long the agent worked — the one duration scrollback
  actually asks for — and, once its transcript has been read, `N turns · M tool uses`. It draws
  no rule across the page: the work between two messages is a footnote to the exchange, lit only under the
  pointer, the way a reading surface folds its thinking. Its chevron TRAILS the words, and so does every
  other disclosure in the conversation — the work fold, each tool row, the live tail's steps — so a folded
  thing reads content-first and one shape at the end of a line says "open" everywhere on this page (the
  trees keep theirs leading, because a tree's chevron is also its indent). The seam owns the transcript for exactly its
  interval (the transcript API already reads by interval; nothing server-side changes), opened directly
  beneath it on a hairline inset so where it came from stays in view, and it exposes the one
  keyboard-reachable disclosure (`aria-expanded`) that interval has. The tail seam of a LIVE session reads
  `working · 4m 12s` in the live green and is the page's only moving thing — no dot in the gutter, nothing
  beside the sentence, the words themselves say it; the tail seam of a dead session says `working` — the
  record's last word — with no duration invented for a stretch nothing closed.
- An EVENT is `error` or `corrupt`: one line — glyph, word, note — with no duration, because it happened
  rather than lasted.

THE RULER. Time lives in a 52px left gutter, tabular and the same for every message row; the day it belongs
to sticks in that same gutter as the reader scrolls; the right edge carries nothing. THE MINUTE IS QUIET: a
reader scans a conversation by what was said and asks for the time only when they need it, so each row's
time rests at reduced opacity and comes up under the pointer or keyboard focus — it never leaves the DOM,
so nothing assistive loses it. The day stays full, because it is structure rather than a stamp. When the PANE (a
container query, not the viewport — a desktop side pane is as narrow as a phone) is under 560px the gutter
goes and each row keeps its own inline time.

Every seam starts folded on first load, after a timeline/status refresh, and when a different session is
selected; no data arrival or remount may open it. The disclosure choice is keyed to the seam's first event,
not to the current transcript interval, so a later event that closes the seam refreshes the interval while
keeping an already-open seam open and an untouched one closed. The timeline body is selectable text:
Conversation chrome does not cancel its pointer press, and rich prose/code preserves authored newlines and
indentation through browser copy. Selection support must not rely on an overlay, `user-select: none`, or an
accidental editable surface. The timeline's own selection is a browser-painted highlight over a Range, never a
document Selection, so the composer caret survives it — and because the cancelled press that keeps that caret
also cancels the browser's click-to-collapse, every press the timeline owns retires BOTH the highlight and any
document Selection lying in the timeline (one the browser made on a fourth quick click, or on a drag begun on a
control). No selection outlives the next click; a press outside selectable text still counts as the timeline's.

That conversation is the whole terminal-free console, with no [[message-stream]] native-event drill-down. 

## the paper, and where its grammar was borrowed from

The surface is the PAGE the conversation is printed on — the theme's own `--paper`, dark or light as the
preset says, never a cream forced over the product — and it borrows from two public references, checked
rather than imagined. From assistant-ui's open-source Claude example
(<https://www.assistant-ui.com/examples/claude>): the person's turn is a right-aligned sheet capped near
80% of the column, the assistant's turn is plain full-width text sitting directly on the ground with no
bubble and no avatar, the composer is one thin-bordered card with no shadow of its own, and the actions
around a message stay out of sight until hover. From Anthropic's own frontend-design guidance
(<https://github.com/anthropics/claude-code/blob/main/plugins/frontend-design/skills/frontend-design/SKILL.md>):
"structure is information" — every structural device here (the day, the chip, the seam) encodes something
true about the record and none decorates; "spend your boldness in one place, keep everything around it
quiet" — the one bold thing is the exchange itself, so the time, the seam and the chip all step back; and a
quality floor that is not announced — responsive to the pane, visible keyboard focus, reduced motion
respected. What was deliberately NOT borrowed: the cream palette and the serif face, because the theme owns
colour and [[typography]] owns the voice.

**Both session surfaces frame their content identically.** The Conversation's composer FLOATS over its
reading column, the same shape Command Box already has on the terminal surface, and the timeline pads its
tail so the newest entry is never parked behind it. That is what makes the surface a property of the
content and not of the frame: choosing Terminal or Conversation changes what fills the document area, never
how many chrome rows sit around it, which is exactly the claim [[ui-state-model]]'s budget measures. The
composer's card IS its field — one frame, not an input bordered inside a bordered bar — and the card is
PAPER: the page's own ground with a hairline frame and the one elevation token, not a panel tint laid over
the flow, so it reads as part of the sheet the conversation is printed on. Its primary action is the shared
send mark ([[icon-system]]'s `send`, the same accent square the thread's composer wears): icon-only, its
word carried by the tooltip and the accessible name, filled while there is something to send and quiet
while there is not, so every dashboard composer says "send" by one shape. The Command Box title and its
`@`, `[[`, `/`, and attachment doors remain in the Conversation footer and act on that same draft; the
separate terminal Command Box opener is the only command control disabled on this surface. TimelineChat's composer always sends `replyVia:"note"`: this is the fixed
terminal-free surface property, and the note data arrives because the agent executes the external
`spex session <verb> --note` CLI; hooks only prompt the agent at turn boundaries and carry no note data.
Session rows still carry only their status and activity vocabulary — no redundant mode badge.

**Stop lives in the composer, and only while there is something to stop.** While the session is `working`
the composer shows one stop square beside send — the mark every chat reader knows as "stop generating" —
and shows nothing otherwise, because a permanently visible disabled stop is chrome about a state the page is
not in. It calls the one interrupt verb ([[dispatch]]); the backend decides between the adapter's native
interrupt and, for a pane-backed TUI, the operator's own key into its pane, so this surface never learns
which transport it is on. A refusal lands in the composer's error line like a failed send; a success asks the
timeline to refresh. The current turn itself is drawn above as the live tail ([[message-stream]]), in this
conversation's own grammar.

TimelineChat's
message composer is the shared [[composer]] textarea and auto-growth path, with the same Enter / Shift+Enter /
IME-send boundary as Command Box; its docked mobile and desktop hosts do not invent a second textarea
mechanism.

A
pane-backed Conversation mounts only on its first visit, then remains mounted after deselection or going offline
so its timeline cursor and rendered history survive revisits; its refresh timer runs only while selected.
Headless sessions follow that same Conversation lifetime from their first selection. Unvisited Conversation
surfaces remain inert and make no timeline/detail reads or polling timers. 
