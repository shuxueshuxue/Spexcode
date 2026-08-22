---
title: prose-dispatch
status: active
hue: 202
desc: What a reader does with a selected passage — hand it to a session, follow it there, or edit it in place.
code:
  - spec-dashboard/src/ProseActions.jsx
related:
  - spec-dashboard/src/SpecView.jsx
  - spec-dashboard/src/proseSelection.js
  - spec-dashboard/src/codeSelection.js
  - spec-dashboard/src/styles.css
---
# prose-dispatch

## raw source

Select a passage of spec prose and a small group of actions appears next to it: **Send to Session**,
**Edit & Send**, **Explain**, **Edit Manually**. Picking one opens a little box beside the pointer — an
optional message, which session it goes to, three preset intents (edit / polish / explain). Two ways to
send: plain send leaves you where you are, **Jump to Session** takes you there. Explain answers in the
session and does not touch the spec. All of it floats; none of it is a strip.

## expanded spec

**Three verbs, and the only difference is where the answer lands.** Hand the passage to a session and keep
reading; hand it over and FOLLOW it, because the answer is the thing you wanted; or change the passage
yourself. The first two are the *same send* — "Jump to Session" is a navigation that happens after the send
returns, which is why it is a second button and not a second mode. The message is byte-identical either
way.
The verb a reader picks is a seed, never a mode: the same box opens for all of them.

**One channel, no second transport.** The passage becomes an ordinary [[code-selection]] token inside an
ordinary prompt and travels the one input route every other surface uses ([[dispatch]]). [[code-selection]]
already rules that "no API route, session field, or alternate dispatch path belongs here", and none is
added: an existing target receives the prompt through the session input route, and **a new session cannot
receive anything at all** — it does not exist yet — so that target seeds the same one-shot compose handoff
the board already uses and the human presses send on the launch face. Naming that honestly is what keeps
"send" from meaning two different things.

**The verbs seed the box; they are not modes.** Each action opens the same popover, differing only in what
it puts in the message field and which send mode it defaults to. The three preset buttons are the same
seeds, available after the fact. Every preset is text the human can still edit before sending — a preset
that could not be changed would be a command, and this surface sends context, not commands.

**Explain is answer-only, and says so in the message it sends.** Reading a passage out loud must never
become an unrequested edit, so its preset asks the target to answer in the conversation and leave the spec
alone. It is also the one verb that defaults to jumping, because its whole value is the reply.

**Edit Manually holds SOURCE, not rendered text.** The editor opens on the passage's verbatim body lines,
because the bytes it commits are the bytes in the file, and it sends back the region it was opened with so
[[spec-body-edit]] can refuse an edit whose ground moved. A refusal is shown in full — including the text
that is actually there now — rather than collapsed into "failed". After a commit lands, the node
re-versions from it and drift re-derives; this surface writes nothing else and tracks nothing itself.

**Everything floats.** The action group and both cards are fixed z-layers over the reading column, dismissed
by Escape (through the shared layer stack, so the document below never also closes) or by a press outside.
The reading column is exactly as wide with a selection as without one, and no chrome band appears —
[[ui-state-model]]'s budget counts overlays as layers, and this must stay true rather than merely happen to
be true. Pressing an action never steals the browser selection out from under itself, which is the one bug
an affordance that acts on a selection cannot have.

**The right-click menu is the same group.** Same items, same handlers, anchored at the pointer instead of
at the passage — one component with two anchors rather than a menu that can drift from the bar it mirrors.
