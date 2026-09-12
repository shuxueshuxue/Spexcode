---
title: widgets
hue: 165
desc: A session-owned named HTML component the agent redraws at will, rendered inline in the conversation, whose only way to reach the agent is a draft the human sends.
code:
  - spec-cli/src/session-widgets.ts
related:
  - spec-cli/src/cli.ts
  - spec-cli/src/guide.ts
  - spec-dashboard/src/widgetGuide.test.mjs
  - spec-cli/src/help.ts
  - spec-cli/src/index.ts
  - spec-cli/src/sessions.ts
  - spec-dashboard/src/SessionWidget.jsx
  - spec-dashboard/src/widgetRefs.js
  - spec-dashboard/src/TimelineChat.jsx
  - spec-dashboard/src/Transcript.jsx
  - spec-dashboard/src/proseTokens.js
  - spec-dashboard/src/data.js
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/i18n/en.js
  - spec-dashboard/src/i18n/zh.js
---
# widgets

A widget is a picture the agent draws, not an application. It is one HTML document under a name the
session owns, and it can do exactly two things: show what the agent put in it, and write a draft into the
human's input box. It holds no state of its own. What was decided lives where every other decision lives,
in the session's messages and declarations, so a reload, another machine, or a later reader all see the
same thing: the last picture the agent drew, and the messages around it.

That is the whole model, and every rule below follows from it.

## one name, one current version

What the agent authors is one ordinary HTML file holding a page's CONTENT: markup, its own `<style>`, its own
`<script>`, written wherever the session keeps its scratch work and rewritten in place whenever the picture
changes. The document around it is the host's: the host supplies the doctype, the head, the theme, the state
and the one bridge object, and puts the file's markup in the body. Owning the wrapper is what lets those
things exist before the widget's own script runs, without the host having to splice text into a document
someone else wrote. An author who writes a whole document anyway still renders, because a parser drops the
nested `html`, `head` and `body` tags and keeps their content. Nothing about the file is special until it is
put, and its path is not what is remembered.

`spex session widget put <name> <path>` reads the file's bytes, stores them in the repository's
content-addressed store ([[evidence-store]]), and points the name at that hash. Putting the same name
again is an update: a new hash, the same name. The session owns one `widgets.json` beside its `runtime.json`,
the way it owns [[files]]' list, and that file is the whole durable index: each name maps to the body's hash
and to the current state, the state inline because it is small and only its latest value is meant to survive.
The document a browser receives exists only at render time — the body's bytes with the host's theme, the
session's identity, the state and the one bridge function injected into it — and is never a file on disk. The name is the identity a human and a rule can talk
about; the hash is what any reader actually renders, so an older reference keeps showing what it showed
when it was written even after the agent has moved on.

This is deliberately unlike [[files]], which records a live path and copies nothing. A file is handed over
once and opened on demand, so a path that still resolves is enough. A widget is embedded in prose that
stays readable forever, drawn from a scratch file the agent rewrites and eventually deletes; a path would
make the timeline's history change under the reader, and break entirely once the file is gone. The cost is
that every put keeps its bytes: the store has no reclamation today, so a widget updated on a timer
accumulates. That is accepted for now and is the first thing to revisit if the store grows.

A state declaration carries widgets the same way: `--widget <name>=<path>` puts and names them in the
same step that records the declaration, so the picture and the words that point at it land together.

`ls` reads the session's widgets with their current hash, and `retract` removes a name. Retracting leaves
prose that pointed at the name visibly unresolved rather than silently empty, the same honesty
[[files]] keeps for a path that has disappeared.

## pointing at one

Prose points at a widget as `[[widget:<name>]]`, resolved against the widgets of the session whose text
holds it, exactly as `[[file:<name>]]` resolves against that session's posted files ([[mentions]]).

One widget renders once per conversation view: the last place its name appears is the live one, and every
earlier mention of the same name is a plain link to it. Without that rule a progress widget rewritten
fifty times would leave fifty live frames in one timeline, each a full document. The reader who wants the
older picture follows the link and gets that version's own hash.

## rendering is the same execution surface as a posted HTML file

The widget renders in an ordinary inline iframe, on the dashboard's own origin, with scripts running and no
restriction placed on the document. This repeats, rather than re-decides, the contract [[files]] already
states for HTML preview: an agent-published document is trusted code, and this surface is not a security
boundary. A widget can therefore reach the page that embeds it, and a careless script can disturb the board
for whoever is looking at it; that is the same risk the project already accepts for previewing a posted
report, taken here for the same reason, that the author is the session's own agent.

A widget wears the dashboard's palette: its tokens are written into the document, and the document's
`color-scheme` is the one the root resolves rather than a guess from the theme's name, since which of
notion, gruvbox and dracula are light is not in their names. A theme is applied by writing an attribute on
the root, which React never sees and which can land after a frame has already rendered, so the attribute
itself is watched: switching theme redraws every open widget in the new palette instead of leaving one
island in the old one.

Being same-origin is also what keeps the mechanism small. The host does not need a message protocol to do
its half of the work: it writes the dashboard's current theme tokens into the document, installs the one
function below directly on its window, and has the document report its own height by calling back. A
postMessage vocabulary would buy nothing here and would have to be versioned forever.

THE HEIGHT IS REPORTED, NOT MEASURED FROM OUTSIDE, and that is a rule about lifetime rather than taste.
Same-origin makes the outside version look free — the host can observe the frame's own body in one line and
the widget needs no cooperation at all — and an observer registered across a document boundary makes BOTH
documents run their full rendering lifecycle every vsync for as long as it is connected, whether or not
anything ever resizes; one that outlives the document it watches goes on doing that forever. Measured on a
live conversation carrying two widgets, with two such observers left behind on documents no frame owned any
more: sixty style recalculations and sixty commits a second for a height that never changed, 7.4% of a core
against 3.2% with them disconnected. The observer therefore belongs to the document it observes, where it
is destroyed along with it — a new body, a reload or an unmount takes both, and no host-side lifetime is
left to get wrong. The host still injects it, so a widget author writes nothing and one who forgets still
sizes correctly. The host sizes the frame to what is reported up to a bound, and scrolls beyond it, so a
widget that grows without limit cannot push the conversation off the screen.

## the only way to the agent is a draft the human sends

A widget cannot send a message. `spex.draft(text)` replaces the widget's pending draft; the host shows that
draft as a block above the input box, folded to one line when it is long and openable in full. Nothing
reaches the agent until the human presses the same send control they use for anything they type. Clicking
inside a widget is therefore always safe, and the human always knows whether an action of theirs has an
outcome, by looking at one place.

Batching falls out of this. Ticking six boxes and filling a field leaves one draft, which becomes one
message, so the agent receives a whole decision rather than six fragments.

Removing the block means this message will not carry that widget's contribution. It is not an undo of what
was clicked, and the host does not try to edit the widget's own interface, because only the widget can draw
it. Instead the host reloads the frame, which returns the document to the body plus its last committed
state; the reader sees an interface that agrees with the empty input box again. Sending does not reload:
the interface stays where the human left it, now backed by the state that send committed, until the agent
draws its next version.

Both controls — send and discard — also sit in the frame's own chrome, the way a copy button sits on a code
block, and appear there only while this widget has a draft. A human who has just
finished clicking should not have to travel to the bottom of the page to act on what they clicked. Both
places drive one send: the message that goes is whatever the input box holds, typed text and other
widgets' blocks included, so pressing a widget's send is pressing the human's own send from a closer
place, never a second private channel out of that frame.

## where a widget's numbers come from

Three sources fill a widget, and which one a number comes from is decided by who is able to know it.

Facts the system already holds — which sessions exist, their status, what a branch is ahead by, how many
lint errors there are — the widget reads for itself. It runs on the dashboard's origin with nothing taken
away, so it can call the same HTTP surface the dashboard calls; the host tells it which session it belongs
to and where the API is rather than leaving it to guess. Nothing agentic happens in between, because nothing
agentic is involved: a table of children and their states is a query, and routing a query through a language
model to retype its answer into a document would be slower, more expensive and less correct. The cost of
reading live is that the widget stops being a record of a moment: opened later it shows today's answer, or an
error when the backend is gone.

What only the agent knows, the agent draws: how far along its plan is, what it is blocked on, which question
it needs answered, what it judges the options to be. No query produces those, and this is most of why a
widget is worth having at all. Such a picture is baked in at put time and goes stale until the agent draws
again, which is honest: it says what the agent knew when it said it.

What the human chose is stored with the widget, as below, so the interface keeps agreeing with their clicks
without the agent having to redraw. The agent redraws when the MEANING changes, not to repaint a checkbox.

The reason the record stays prose rather than a structure the host could replay into the widget's fields is
that a replayable structure requires every widget to declare its fields, their types and their identities.
That is the interface language this contract deliberately does not invent: the moment it exists, a widget can
only say what the language can express. Prose is what the agent acts on anyway. If the system later needs to
know a chosen value as data, the narrow move is to let one sent message carry a small payload beside its
prose — not to give every widget a schema.

## a name holds two layers, and each has one writer

A widget name holds a BODY and a STATE. The body is the document the agent drew and is the agent's to write:
it is the blob the last put stored, addressed by its hash. The state is what the human chose and is written
by the send: it is the value inline under that name in the session's `widgets.json`. The asymmetry is the
write pattern, not an accident — a body is a whole document that is replaced wholesale and worth keeping each
version of, while a state is a few dozen bytes overwritten on every click, and storing each of those as
another copy of the document would be waste with no reader.

Neither lives in a browser. A person's choice survives their refresh, their laptop, and the closing of the
session, because it is kept where the rest of the project's record is kept.

The state reaches the widget through the host's wrapper, the same way the theme does: it is there as data
before the widget's first line of script runs, so the widget draws itself from it rather than being patched
afterwards. That is what makes "A is ticked" survive a reload without the agent doing anything. The state's
shape is the widget's business and the host never interprets it; the host stores the bytes and gives them
back. That is what keeps this from becoming the interface language this
contract refuses to invent.

Sending commits both halves in one gesture: the message goes to the agent as prose, and the state the widget
handed over with `spex.save(state)` becomes the widget's new state. Storing the state rather than a whole new
copy of the document is deliberate: a body is tens of kilobytes and a choice is a few dozen bytes, and the
store does not reclaim.

The two are not two answers to one question. The message is the EVENT, and it is the ground truth: it is what
the agent acts on, what the CLI prints, what another agent reads, and what is still legible a year later. The
state is the VALUE that event left behind, kept next to the picture so the picture can render it. If they ever
disagree, the messages are right and the state is stale.

The agent may write the state too — it reads the current state, and when it redraws it either carries the
state forward, which is the default, or clears it because its new picture asks a different question.

What has NOT been sent is not stored anywhere. Ticks made and not sent are a draft, like a half-typed
sentence, and a reload returns the frame to the body plus its committed state, which is also exactly what
removing the draft block does. Persisting an unsent choice would make a durable record out of something the
human never said.

An agent that redraws a widget while a human has an unsent draft in it does not swap under them. The host
keeps showing the version they are working in and offers the newer one; their own send, or discarding the
draft, is what lets it through. Replacing a form mid-edit to show fresher numbers trades the thing being
done for the thing being displayed.

## how an agent learns it exists

The always-materialized system contract carries one operational line: when a picture serves the human better
than a paragraph would, draw it with `spex session widget put` and point at it as `[[widget:<name>]]`. The
rest lives in `spex guide widget` — what a widget may contain, the three members of its bridge, what survives
a reload, and when a picture is worth drawing at all — exactly as [[files]] keeps its detail in its own guide
rather than growing the prompt.

There is no template library, and the guide's examples are the templates instead. A progress bar is twenty
lines of HTML that every model writes well, and a shelf of them would be a second surface to keep in step with
the theme tokens and the bridge while adding nothing an example does not. What an agent actually needs is the
contract: that it writes content rather than a document, that its clicks fill a draft rather than send, and
that it draws itself from `spex.state`. Those are sentences, so they live in a guide.

THE EXAMPLES ARE CHECKED LIKE CODE, which is what makes carrying them in prose safe. The cost a template
library would have — a second surface drifting away from the tokens and the bridge — is a cost prose pays
too, and silently: the guide described a three-member bridge for as long as the host installed five, so the
two members that make a live-reading widget possible were the two an author could not find. So every token
and every bridge member the guide teaches is read back out of it and checked against the token list the host
injects and the object it installs, the author-facing half of the bridge must appear there, and the frame's
height bound must be stated in the number the host enforces. A guide that teaches something the host does not
provide is a failing test, not a documentation bug someone notices later.

The three examples are the three shapes, and the third is the one that needs the machine's help: a picture
that reads live facts for itself. It is the case this contract already argues for — a table of children is a
query, not something to retype through a model — and the case with the most ways to be wrong, because it is
the only one with a backend that can be missing.

## what this contract does not cover

Committed state is shared by everyone who opens the widget, but nothing here makes two people editing one
widget a live experience: a second viewer sees a choice when their frame next loads, and the last send wins.
There is also no widget-to-widget communication, no way for a widget to call a tool or change a session's
state, and no pinning of a widget outside the conversation. Each of those needs its own reason and its own
contract; none is required by the two things a widget is for, which are showing the human what is happening
and letting them answer in one gesture.
