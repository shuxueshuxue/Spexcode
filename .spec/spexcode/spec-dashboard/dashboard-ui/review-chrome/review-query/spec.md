---
title: review-query
status: active
hue: 205
desc: The ONE token-query engine behind both review lists — scanner/parser/serializer, token surgery, last-wins matcher, legacy-param replay, and bounded inline autocomplete — pure JS with named exports any consumer can reuse.
code:
  - spec-dashboard/src/reviewQuery.js
related:
  - spec-dashboard/src/route.js
  - spec-dashboard/src/reviewQuery.test.mjs
---

# review-query

## raw source

GitHub's issues UI (measured live on github.com/microsoft/vscode in a real Chromium) keeps ONE source of
truth — the raw query text; tabs, menus, and suggestions only rewrite tokens inside it, and the URL
carries the text verbatim. SpexCode's two review lists previously split state between a substring input
and structured hash params — the exact fork GitHub's model eliminates. This engine is that model as a
standalone pure-JS module: no React, no DOM, importable by the pages, the route layer, and any future
consumer that needs canonical review addresses (e.g. eval anchors on other boards).

## expanded spec

- **Scan loses nothing.** The scanner splits text into whitespace runs and tokens with exact [start,end)
  offsets — a `"` swallows spaces until it closes, as a whole phrase (`"long title"`) or a qualifier
  value (`node:"a b"`) — so the highlight overlay mirrors the input glyph-for-glyph and the caret's token
  is findable. A token is `key:value` (key case-insensitive) or a bare word; serialize(tokenize(text)) is
  the canonical form and unknown tokens survive verbatim.
- **Surgery is the only write.** setToken rewrites a key at its first position, drops later duplicates,
  appends when absent, and removes the key on an empty value; every other token — known or not — keeps
  its order and spelling. Reads and the matcher agree on LAST-occurrence-wins for a duplicated qualifier.
- **The matcher is conjunctive and honest.** Pages supply field predicates per qualifier plus one $text
  predicate for lowercased bare words. A qualifier the page defines no field for matches NOTHING — the
  unknown token is kept, uncolored, runs, and yields the filtered-zero empty face; never an error, never
  stripped, never a full-text fallback.
- **Default view = bare address.** queryParam compares token-normalized text against the page default
  (Issues `is:issue state:open`, Evals `is:eval state:current`) — equal or empty means the bare page
  address, anything else exactly `?q=<raw text>`. The evidence default is `all` with no hidden
  data-dependent fallback.
- **Legacy params replay as the full visible state.** An old structured list address rebuilds the
  default text with each param surgically applied — state/concluded→state:, ok=1→state:reviewed,
  kind→evidence: (kind=all → nothing), store/author/node/filer/verdict/freshness→their token,
  live=1→session:present, session=&lt;id&gt;→scope:&lt;id&gt; — and the free q appended as ONE text token,
  quoted whenever the tokenizer would misread it (spaces, a colon like q=drift:check, a stray quote) so
  the old single-substring search survives verbatim. The route layer applies this as a REPLACE; the old
  shape is never re-minted.
- **Autocomplete is bounded.** A bare prefix completes qualifier keys (insert `key:`, keep typing); a
  `key:prefix` completes values from the page-supplied candidates only — data-derived sets, and for
  `scope:` only sessions on the current board — capped at 8. Unknown or historical values remain
  hand-typable and submit verbatim.
