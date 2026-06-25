---
title: relay
status: active
hue: 280
desc: spex relay <q> — the spec→code relay: the floor's top spec hits, each with its governed code: files, so an agent jumps topic→spec→code in one call.
code:
  - spec-cli/src/relay.ts
---

# relay

## raw source

The lexical floor ([[spec-search]]) answers "which spec governs this topic?"; the natural next question is
"so which **code** do I read?". The relay closes that gap in one call: `spex relay <query>` runs the floor,
then hands back each top hit's **governed `code:` files** — the files that node's contract owns. An agent
that found the right spec by user-story jumps straight to the code, instead of opening the node and
hand-copying its `code:` list. It is the third consumer named in [[spec-scout]]'s locked contract, beside the
human `spex search` list and the `--deep` rerank.

## expanded spec

`spex relay <query> [--json] [--limit N]` (default limit 3). It **adds no ranking of its own**: it reuses the
frozen floor's `searchSpecs` for the order and the shared spec index (`loadSpecs`) for each hit's `code:`,
returning `{ id, title, path, score, code[] }` — the floor's shape with `snippet` swapped for the governed
`code` paths. `--json` prints that array; the default prints each hit and indents its files. The contract is
unchanged: this is a downstream **reader** of `spex search`, never a new scorer.

**Known v1 limitation (not hidden):** it returns each hit's **own** `code:` only — it does NOT aggregate a
node's children. So when the top hit is a pure-prose *parent* (e.g. `injected-context`, whose code lives in
its child `spec-first`), relay yields an empty `code:` for it even though descendants carry files. The honest
fix — fall through to children's `code:` when a top hit is codeless — is a candidate next step, flagged
rather than silently papered over. For a query whose top hit is a leaf with code (the common case — e.g.
`relay "how does exit close a session"` → `session-console` + its `SessionInterface.jsx` …) it lands exactly.
