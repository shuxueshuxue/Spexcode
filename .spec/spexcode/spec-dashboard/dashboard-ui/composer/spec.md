---
title: composer
status: active
hue: 265
desc: One quiet, auto-growing editor shell shared by every dashboard-authored composer; each home supplies its own grammar and actions.
code:
  - spec-dashboard/src/Composer.jsx
related:
  - spec-dashboard/src/Thread.jsx
  - spec-dashboard/src/IssuesPage.jsx
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/TimelineChat.jsx
  - spec-dashboard/src/MobileApp.jsx
  - spec-dashboard/src/textarea.js
  - spec-dashboard/src/styles.css
  - spec-dashboard/test/command-box.e2e.mjs
---

# composer

Command Box, TimelineChat, session launch prompts, issue replies, eval remarks, and a new issue's description
are different product actions, but
they should not each invent a textarea. They share one small editor shell: a quiet bordered surface, a borderless controlled
textarea that grows from a useful floor to its home's cap, and a persistent action footer. The footer is
part of the shell's geometry, so growth adds lines **above** it instead of moving the primary action around.

The shared primitive owns layout, textarea measurement, focus styling, disabled state, and the IME guard
that distinguishes a composition commit from an ordinary Enter. It deliberately does **not** own domain
meaning. Message homes decide that plain Enter sends and Shift+Enter adds a line; launch homes keep Enter as
native long-form editing and submit only from their explicit action. Each home still supplies its placeholder,
menus, triggers, attachment controls, send behavior,
error copy, and draft lifetime. Issues and Evals keep the one `ReplyComposer` behavior in `Thread.jsx`;
Command Box keeps its session control grammar in [[command-box]]; the Issues compose page ([[issues-view]])
mounts the same shell with its own action row and submit. Reuse stops at this natural boundary,
instead of growing a parameter-heavy universal message form.

The surface uses the dashboard's existing type and color tokens, an at-most 8px radius, and no nested card.
It has stable width and responsive constraints so menus, long words, progress, and errors cannot resize or
spill it. A host may dock it in document flow or suspend it over a terminal; that placement is outside the
primitive, while its internal editor/footer geometry stays identical.
