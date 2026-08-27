---
title: prose-dispatch
status: active
hue: 202
desc: What a reader does with a selected passage — hand it to a session, follow it there, or edit it in place.
code:
  - spec-dashboard/src/ProseActions.jsx
related:
  - spec-dashboard/src/Composer.jsx
  - spec-dashboard/src/mentions.jsx
  - spec-dashboard/src/SelectionAttachment.jsx
  - spec-dashboard/src/SpecView.jsx
  - spec-dashboard/src/NodeView.jsx
  - spec-dashboard/src/FileView.jsx
  - spec-dashboard/src/SourceView.jsx
  - spec-dashboard/src/specContent.js
  - spec-dashboard/src/proseSelection.js
  - spec-dashboard/src/codeSelection.js
  - spec-dashboard/src/styles.css
---
# prose-dispatch

## raw source

Select a passage of spec prose, then open the native context menu, and a small group of actions appears next
to the pointer: **Send to Session**, **Edit & Send**, **Explain**, **Edit Manually**. Picking one opens a little card beside the pointer — the
passage as an attachment, an optional message, and who receives it. The card is the same composer every
other box on the board is: `@` and `[[` complete in it, `/` offers the three preset intents (edit / polish /
explain), and its footer reads like Command Box's — except that its first control is an **address**, because
this is the one composer that does not already stand inside its target. **Jump to Session** is a toggle on
that footer: on, the send takes you there; off, you keep reading. Explain answers in the session and does
not touch the spec. All of it floats; none of it is a strip.

The same four-action group is reachable from a selected governed source file and from the spec pane in the
node information popup. A source selection keeps its path and inclusive line range as the ordinary
`[[code-selection]]` attachment — drawn by the one shared attachment primitive, and removable from the send
card, which clears the selection; its manual-edit verb is visibly unavailable because source files remain
read-only on the board and are changed through a session. The source viewer hands its host to this action
layer so a native right-click on a CodeMirror selection opens the same group at the pointer even when the
browser Selection API is empty; it uses the already-captured path, text, and inclusive range rather than
reconstructing source bytes from DOM text. A body that is still loading exposes a disabled
group with a small spinner rather than accepting a no-op click.

## expanded spec

**Three verbs, and the only difference is where the answer lands.** Hand the passage to a session and keep
reading; hand it over and FOLLOW it, because the answer is the thing you wanted; or change the passage
yourself. The first two are the *same send* — "Jump to Session" is a navigation that happens after the send
returns, which is why it is a toggle on the footer and not a second mode or a second button. The message is
byte-identical either way. The verb a reader picks is a seed, never a mode: the same card opens for all of
them, differing only in what it puts in the message and whether the toggle starts on.

**The card is the fifth home of the one composer, not a second input dialect.** It mounts the shared
[[composer]] shell — the same surface, auto-growing textarea, IME guard and persistent footer as Command
Box, the New box and the thread reply — floated at the pointer, with the passage riding in the preview slot
as the shared [[selection-attachment]] row. Its message takes the whole [[mentions]] grammar through the one
shared autocomplete: `[[node]]` and `@session` complete exactly as they do everywhere else, and the footer
wears the same `@` `[[` `/` doors. Nothing in this surface may grow its own textarea, its own list of
sessions, its own row of buttons, or its own keyframes.

**The address is the verb's argument, chosen in the `@` language.** Every other composer already stands
inside its target; this one has to name it, and it does so as `spex session send <id>` does — an address
beside the message, never a leading `@` inside it (an `@` typed in the message stays the passive reference
[[mentions]] defines). The footer's address chip shows the recipient in the shared session identity language
(avatar, headline, lifecycle glyph) or `new · <launcher>`; opening it swaps in a one-line `@` field whose
rows are the shared autocomplete's over the LIVE sessions only — `sessionFooterState(session) === 'live'`,
so idle sessions remain targets while offline and archived records do not — with its `@new` and
`@new:<launcher>` rows. The launcher a new session takes is therefore chosen in the open, and it is the
same remembered launcher the New tab keeps, so the two launch doors never disagree. The default recipient
is a live session already working on this node, else the newest live session, else a new one.

**The presets are `/` commands.** Edit, polish and explain are rows of the shared `/` palette, filed as
`[preset]`; accepting one writes its text into the message at the token, where the human can still change
it — a preset that could not be changed would be a command, and this surface sends context, not commands.
The action group's Edit & Send and Explain verbs are those same presets applied at open.

**One channel, no second transport.** The passage becomes an ordinary [[code-selection]] token inside an
ordinary prompt and travels the one input route every other surface uses ([[dispatch]]). [[code-selection]]
already rules that "no API route, session field, or alternate dispatch path belongs here", and none is
added: an existing target receives the prompt through the session input route. Choosing a new session uses
the existing `createSession(prompt)` API in the same click, marks the returned session as a fresh workspace tab
and opens it — [[tab-routing]] treats creation as a gesture, so the new session appends beside the document the
passage came from and never replaces its tab — and there is no second launch-face send. The target list uses the shared `sessionFooterState(session) === 'live'` predicate;
idle sessions remain dispatch targets while offline, archived, and other non-live records do not.

**Explain is answer-only, and says so in the message it sends.** Reading a passage out loud must never
become an unrequested edit, so its preset asks the target to answer in the conversation and leave the spec
alone. It is also the one verb that defaults to jumping, because its whole value is the reply.

**Edit Manually holds SOURCE, not rendered text.** The editor opens on the passage's verbatim body lines,
because the bytes it commits are the bytes in the file, and it sends back the region it was opened with so
[[spec-body-edit]] can refuse an edit whose ground moved. A refusal is shown in full — including the text
that is actually there now — rather than collapsed into "failed". After a commit lands, the node
re-versions from it and drift re-derives; this surface writes nothing else and tracks nothing itself.

**Everything floats, and floats in with one of two motions.** The action group and both cards are fixed
z-layers over the reading column, dismissed by Escape (through the shared layer stack — one layer per
press: an open completion menu, then the address field, then the card, never the document below) or by a
press outside. Dismissing a card also retires the action group that opened it, so the group never flashes
back for one paint while the outside press is being handled. The group *rises* (the menu/notice motion) and the cards *pop* (the card/dialog motion):
the board's two overlay motion words, each a token duration and both silenced under reduced motion.
The reading column is exactly as wide with a selection as without one, and no chrome band appears —
[[ui-state-model]]'s budget counts overlays as layers, and this must stay true rather than merely happen to
be true. Pressing an action never steals the browser selection out from under itself, which is the one bug
an affordance that acts on a selection cannot have.

**The right-click menu is the same group.** The primary-button selection gesture only records the passage;
the native context-menu gesture is what reveals the actions. Same items, same handlers, anchored at the
pointer instead of at the passage — one component with two anchors rather than a menu that can drift from
the bar it mirrors.
