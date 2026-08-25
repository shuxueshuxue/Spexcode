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

Conversation status rows expose one keyboard-reachable disclosure button (`aria-expanded`) for each `▸ N turns · M tools` transcript entry. Every entry starts folded on first load, after a timeline/status refresh, and when a different session is selected; no data arrival or remount may open it. The disclosure choice is keyed to the status event, not to the current transcript interval, so a later status that closes the interval keeps an already-open entry open and keeps an untouched entry closed. The timeline body is selectable text: Conversation chrome does not cancel its pointer press, and rich prose/code preserves authored newlines and indentation through browser copy. Selection support must not rely on an overlay, `user-select: none`, or an accidental editable surface.

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
