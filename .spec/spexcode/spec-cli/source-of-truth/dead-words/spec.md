---
title: dead-words
status: active
hue: 15
desc: The vocabulary backstop — a CI grep gate keeping the v0.3.0 renames' retired words (yatsu · reading · board · proof · blob · scan · reopen · rawkey · loss-signal) off every product surface; prose stays exempt.
code:
  - scripts/dead-words.mjs
related:
  - .github/workflows/ci.yml
---
# dead-words

## raw source

The v0.3.0 rename cut every concept to one word (eval, graph, evidence, …). A rename that isn't
guarded regresses: the next error message, route, or file casually reintroduces the old name and the
one-word-one-meaning economy erodes. So the retired words are **dead on product surfaces** — command
names, route/protocol strings, agent- and user-facing labels, file names, node dir names — while
**prose stays legal** (spec bodies, docs, code comments, archived sidecars may narrate history under
its historical names). CI enforces this permanently.

## expanded spec

`scripts/dead-words.mjs` (a CI step beside `spex spec lint` in [[ci-gate]]'s workflow; runnable
locally, exit 0 clean / 1 findings) scans exactly the surfaces where the words are dead, not the
whole repo:

- **string literals** in source under `spec-cli/src`, `spec-eval/src`, `spec-forge/src`,
  `spec-dashboard/src`, `spec-cli/templates` — a command, route, or label lives in a string; a code
  comment is prose and never scanned. A real tokenizer (comment/string/template/regex-aware) does the
  extraction, so a quoted word inside a comment can't false-positive and a regex body can't open a
  phantom string. `*.test.*`, `__fixtures__`, and `*.md` are exempt (test data mirrors archived or
  external shapes; markdown is prose).
- **whole non-comment text of shell hooks** under the same roots — hook scripts speak to agents at
  runtime, so their text is label surface, not prose.
- **file and dir basenames** under those roots, and **node dir names** under `.spec` — split on
  camelCase and separators, so `BoardStats.jsx` hits while `Dashboard.jsx` (one word) does not.

The exemption mechanism is deliberately in-place, not a central list: a line carrying
`dead-words-ok: <reason>` is skipped, and the reason is REQUIRED — every exemption self-justifies at
the occurrence. The legitimate classes are narrow: **archive readers** (the freshness walk's dual
pathspec, the retired cache-dir recognizer — immutable history is read under its archived names),
**git plumbing** (`cat-file blob` is git's noun, not ours), and **one-version signposts** (the
unknown-command tombstones that teach the renamed spelling until 0.4.0 deletes them).

The scanner distrusts itself: every run starts with a self-check that plants a dead word in a string,
one in a comment, and one in a regex, and refuses to report a clean tree (exit 2) unless exactly the
string hit fires — a silently broken tokenizer must not green-wash the gate.
