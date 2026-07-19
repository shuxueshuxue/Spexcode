---
title: review-commands
status: active
hue: 200
desc: The review track's slash-command surface — '/' at the start of the eval-detail composer's line opens a command menu, whether typed or inserted by its compact discoverability button. Built-in verbs (/ok) hold their when-gate in ONE registry (the sessionCommands pattern) and are the sole dashboard door to their act; `surface: review` plugin presets (/refuse) prefill the composer, and the send stays an ordinary remark.
code:
  - spec-dashboard/src/reviewCommands.js
related:
  - spec-dashboard/src/EventDetail.jsx
  - spec-dashboard/src/Thread.jsx
  - spec-dashboard/src/mentions.jsx
  - spec-dashboard/src/sessionCommands.js
  - spec-dashboard/src/data.js
  - spec-cli/src/specs.ts
  - spec-cli/src/index.ts
---
# review-commands

## raw source

The review act is fastest in the composer: the human watches a reading, and the judgment — "agreed" or
"disputed" — is a `/` command in the same box the remark goes in. A compact `/` button beside the
composer's `@` and `[[` grammar hints makes that command surface visible; it types the same trigger the
hand would, never opening a second menu or creating another execution path. The interim standalone
human-ok button was retired because the command is the ONE dashboard door. No new verbs, no new writes:
the commands are doors onto acts the pane already has.

## expanded spec

**The trigger.** In [[event-detail]]'s docked remark composer, a `/token` at the start of the caret's
LINE opens a small command dropdown — the session ❯ box's leading-`/` grammar, per-line so a stamped
`▶` anchor (or a circled frame) above the caret never disarms it: circle → `/refuse` on the fresh line
below is the natural flow. The compact `/` action-row button inserts that exact trigger at the caret,
preserves the draft, refocuses the textarea, and on a command-eligible line opens the SAME dropdown; it
appears only when that home supplies commands, so issue composers remain untouched. Matching, row markup,
and keys (↑↓ · ⏎/Tab · Esc) are the console's own — the shared `matchSlash`/`SlashMenu` in [[mentions]]'s
module, never a fork.

**Kind 1 — built-in review verbs, one registry, one door.** The registry (`reviewCommands.js`,
the [[session-console]] `sessionCommands.js` precedent) holds each verb's static identity + `when` gate;
the host binds the runner per render, and the typed command is the ONE dashboard entry to the act — the
gate lives in the registry alone, never re-judged at a call site. First member: **/ok** fires the exact
[[human-ok]] runner under the registry's gate (the viewed reading is the scenario's latest effective one
and not yet ok'd — the header shows only the settled ok'd mark, no button); outside the gate, typing /ok
offers nothing.

**Kind 2 — preset prose from the `review` plugin surface.** `surface: review` is one more value in
[[surface]]'s field-driven enum, gathered by the same recursive loadSurface and served at
`/api/plugins?surface=review`. The instance shelf is [[.plugins]]'s `review/`; its first resident,
**refuse**, is the human's dispute of the viewed verdict. Picking a preset PREFILLS the composer with
its body — `{node}` `{scenario}` `{expected}` filled at insert time, a stamped `▶` anchor head kept —
and the human edits and sends. The result is an ORDINARY remark on the (node, scenario) thread:
[[remark-teeth]]'s aging pressure IS the refuse semantic, zero new write mechanism.

The surface deliberately does not include /drop — its delete-vs-retire design is still open.
