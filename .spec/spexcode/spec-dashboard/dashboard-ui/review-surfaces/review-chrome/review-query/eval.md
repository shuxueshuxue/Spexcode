---
scenarios:
  - name: engine-contract
    tags: [cli]
    code: [spec-dashboard/src/reviewQuery.test.mjs]
    description: >
      Run the engine's unit suite (node --test src/reviewQuery.test.mjs): character-preserving scan and
      tokenize/serialize round-trip with quoted phrases and quoted qualifier values, token surgery
      (rewrite in place, dedupe, append, remove; strangers verbatim), last-wins duplicate qualifiers,
      unknown-qualifier honest zero in the conjunctive matcher, default↔bare address equivalence, the
      full legacy param table (state/concluded/ok/verdict/freshness/kind/store/author/node/filer/live/
      session, free q as one quoted phrase), and bounded caret suggestions.
    expected: >
      Every test passes: serialize(tokenize(text)) is canonical and lossless, unknown tokens survive
      surgery verbatim, an undefined qualifier matches nothing, legacy params replay to the exact token
      text (kind=all to the plain default), and suggestions stay within the supplied candidates capped
      at 8 — keys complete without executing, values complete the whole token.
---
# measuring review-query

The engine is pure JS with no DOM, so its loss is measured at the unit layer — the browser-level truth
(overlay, menus, Back, legacy replay) is measured by [[review-chrome]]'s token-query scenario, which
consumes this module through the real pages.
