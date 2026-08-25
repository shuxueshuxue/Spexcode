---
title: prose-renderer
status: active
hue: 272
desc: ONE dashboard prose renderer — markdown-it as the only parser, its tokens mapped to React, SpexCode's own marks (node refs, evidence, time anchors) as semantic token plugins, KaTeX the single audited HTML insertion. ACTIVE.
code: spec-dashboard/src/Prose.js
related:
  - .spec/spexcode/spec-dashboard/dashboard-ui/ui-primitives/prose-renderer/migration-payload.md
  - spec-dashboard/src/proseTokens.js
  - spec-dashboard/src/proseTokens.test.mjs
  - spec-dashboard/src/RichText.js
  - spec-dashboard/src/TimelineChat.jsx
  - spec-dashboard/src/NodeView.jsx
  - spec-dashboard/src/Thread.jsx
  - spec-dashboard/test/spec-markdown.e2e.mjs
  - spec-dashboard/test/timeline-chat-interaction.e2e.mjs
---

# prose-renderer

**Status: active** — the shared token-to-React migration now owns spec bodies, issue/review replies, and the
session timeline. The `proseTokens` markdown-it adapter preserves source maps and promotes `[[id]]`, evidence
links, and time anchors to semantic tokens. `SpecBody`, `RichText`, and `Thread` are compatibility names over
that same boundary; no surface pre-strips marks or injects ordinary prose HTML. A current committed-tree
Chromium probe (`spec-dashboard/test/spec-markdown.e2e.mjs`) passes at 1280x800 and 900x844, including the
three semantic payloads and source-map stamps; the TimelineChat selection/copy gate remains separate because
its parked-fixture run still needs a healthy backend.
The current compatibility renderer now covers standard links, remote images, blockquotes, heading levels,
inline/display KaTeX, emphasis, strikethrough, and ordered/unordered lists; `code:`
names the one renderer module and `related:` names every surface that consumes it (the node-body view,
the Issues detail + compose preview, the thread, the session timeline) plus its parser/math dependencies.

## raw source

Agent- and human-authored prose shows up on five surfaces: a spec node's body, an issue's detail body,
every thread reply (issue threads and eval remarks alike), the Issues compose preview, and the session
timeline's messages. It is ONE kind of content, and it is currently produced by THREE different
mechanisms:

- a hand-written tokenizer (`SpecBody`) that knows fenced code, headings, GFM tables, lists, paragraphs,
  links, images, blockquotes, math, emphasis, and strikethrough, while the full semantic-token migration
  remains outstanding;
- the thread's own pre-processing, which strips the `▶m:ss` time anchor and the `/api/evidence/<hash>`
  media links out of the prose with regexes BEFORE handing the remainder to that tokenizer, then renders
  the anchor button and the media beside it as siblings;
- markdown-it + KaTeX behind the session console's timeline renderer, which the console added because a
  coding agent naturally writes real Markdown and LaTeX.

So the same text renders differently depending on where it is read. An ordinary `[text](url)` link is
literal characters in an issue body and a live link in the timeline. `$x^2$` is mathematics in the
timeline and raw dollar signs everywhere else. `*emphasis*` and `![image](…)` are literal in every body.
Every heading level collapses into one visual level in bodies. An in-prose `[[id]]` is a coloured span
that navigates nowhere, while the same reference in a side rail is a real door. And a mark's meaning
lives outside the prose that carries it: the thread's anchor and evidence are torn out of the text and
re-attached next to it, so no other surface can show them at all.

That is the loss this node closes: **one renderer, one dialect, one place where a mark means something.**
The console's engine is the keeper — the hand-written tokenizer and the thread's pre-processing go away
rather than being kept behind a mode switch, because a switch would preserve exactly the divergence that
made this node necessary.

## expanded spec

- **ONE module renders every prose surface.** The node-body view ([[node-popup]]), the Issues detail body
  and its compose preview ([[issues-view]]), every thread reply
  (issue threads and [[event-detail]]'s remarks), and the session timeline ([[message-stream]]) all call
  the same renderer. It carries no page branch and no "rich" vs "plain" dialect: a surface may pass DATA
  (a resolver, handlers, which source it wants rendered) and must name which KIND of prose it holds (the
  line-break contract below), but it never selects a language. Two dialects of one content type is the
  defect, not a feature; one renderer reading two kinds of content correctly is not that defect.
- **markdown-it is the only parser.** Its flat token stream is first grouped into ONE generic token tree,
  then a single mapper turns standard tokens into standard React elements. Ordinary prose is never
  injected as a block of HTML — the tree becomes elements, so React owns the DOM, keys, and events.
  Nothing else re-tokenizes prose anywhere in the dashboard.
- **SpexCode's own marks are semantic tokens, never HTML.** Dialect plugins extend the parser and emit
  meaning only; the mapper decides what a meaning renders as:
  - `spec_ref` (`[[id]]`) → the clickable node chip, navigating through the ONE address vocabulary
    ([[address-routing]]) — the same door the side rails wear, now available in prose;
  - `evidence` (an `/api/evidence/<hash>` media link) → the one shared evidence renderer (`BlobMedia`);
  - `time_anchor` (a `▶m:ss · step` head) → the seek component, with the host's seek/degraded state
    arriving as a handler.
  Because the marks survive as tokens, the thread stops pre-stripping its own prose: the regex
  extraction and the sibling anchor/media rendering are DELETED, and a mark renders in place, wherever
  the text is read.
- **The supported language is a measured contract, and it is BEHAVIOUR, not shape.** The parser runs
  with link autodetection on (`linkify`) and renders standard Markdown:
  real heading levels, emphasis and italics, links, remote images, blockquotes, ordered and unordered
  lists, inline and fenced code, GFM tables, strikethrough. Mathematics is written `$…$`, `$$…$$`,
  `\(…\)`, or `\[…\]`. Images go through the standard image renderer — no allowlist and no
  remote-content policy is added on top of the parser's own untrusted-source defaults. What is
  explicitly NOT contract is the current implementation's *shape*: no options object, CSS class name, or
  HTML-injection strategy is protected — only the visible and behavioural result is, so the renderer may
  be rewritten wholesale into the token→React form above without renegotiating this list.
- **A soft break is not a line break; the content decides.** markdown-it emits `softbreak` wherever the
  author's line happened to end and `hardbreak` only where they asked for one (two trailing spaces, a
  backslash). A hard break always breaks, on every surface. A soft break is where the two kinds of prose
  this dashboard carries genuinely differ, so the surface holding the text names its kind through the one
  `softBreak` option and the renderer does the rest:
  - **documents** — a spec body, an issue body and its compose preview, a thread reply, a previewed `.md`
    file — are Markdown written into a file or a record, wrapped by their author's editor at some column.
    That wrap is typography, so it reflows into a space, exactly as Markdown specifies. Measured, not
    assumed: real issue replies wrap at 78–80 columns, breaking mid-word.
  - **messages** — the session timeline's transcript — are typed into a conversation, where a newline the
    writer entered is part of what they said. Measured the same way: real transcript lines run past 500
    characters without a wrap. They keep their breaks.
  This is not the mode flag this node forbids. That flag would let one text mean two things; this one lets
  one renderer read two kinds of text correctly, while the parser, the token stream, and every mark stay
  identical across both. markdown-it's `breaks` option is NOT how it is done, and is not set: it reaches
  only that library's own HTML renderer, which this boundary never uses, so it changes nothing while
  reading as though it decided everything.
- **What is memoised follows what is actually expensive.** Parsing is a pure function of its source and is
  memoised per surface. Token-to-React mapping is not: the semantic handlers are caller closures over live
  state (timeline events, seek targets) rebuilt on every render, so a memo keyed on them never hits — it
  only looks optimised — and pinning them in a ref would hit while rendering stale anchors. Measured on a
  real 10.5 kB spec body, parsing costs 0.61 ms and mapping 0.30 ms. KaTeX is the one step worth caching
  at the boundary: four formulas cost 0.43 ms to typeset and 0.002 ms once cached, so typeset output is
  keyed by (source, display mode) and shared across every surface, and a source KaTeX rejects is
  remembered as rejected instead of retried on each render.
- **The math delimiter guards are the contract's sharp edge.** An inline marker ignores escapes, refuses
  whitespace immediately inside either end, and fails its scan on a newline or a backtick; a closing
  dollar may be neither half of a `$$` nor followed by a digit. Together those guards are what keep
  currency, shell variables, escaped dollars, and code spans from being eaten as mathematics. A display
  marker opens only at a block start, allows only whitespace after its close, may span lines, must be
  non-empty, and stays ordinary prose while unclosed. Math is never parsed inside inline or fenced code.
- **Mathematics is the one audited HTML insertion.** KaTeX renders inside the math token and only there;
  every other node in the tree is React elements. An invalid expression stays visibly readable — it
  never blanks a message and never throws through React — and an unexpected parser failure degrades to
  the escaped source rather than an empty or broken surface.
- **A rendered formula is ONE copyable thing.** The math engine emits two DOM branches for one formula
  (accessible markup beside the visual layout), so a selection Range across a message will happily copy
  the same expression several times unless the token's output hides every branch but one from text
  extraction. A copy of prose containing mathematics yields each formula exactly once, in its source
  form. This is a real measured defect on the console surface, not a hypothetical: whatever the math
  token's markup becomes in the token→React rewrite, it inherits the browser-level copy proof (a real
  Range over the rendered message, compared against hardcoded expected literals) — a rewrite that
  re-grows the duplicate is wrong even if every formula still LOOKS right.
- **Math weight is real, and the TOKEN is the only loading fact.** Measured on the console's own landing:
  adding the parser plus KaTeX took that surface's JS from ~3.5 kB to ~128 kB gzip and added ~8 kB gzip of
  lazy CSS, while the shared index CSS moved ~0.4 kB and the other bundles did not move; KaTeX's
  stylesheet also copies 59 font fallbacks into `dist` (~1 MB on disk) of which a real browser fetches
  three WOFF2 (~48 kB). Today that weight is isolated behind the console's lazy chunk — and that isolation
  CANNOT be reused once the same renderer serves spec bodies, issues, and review pages: no surface may
  inherit math styling or math code from another surface's chunk, which is how a body silently renders
  unstyled formulas. The honest seam is the token tree itself: when the tree yields a math token, that
  token's own component may lazily import the math engine and its styles, so **presence of a math token —
  never a source-text `$` sniff — decides loading**. A second grammar pass over raw source to guess
  whether math is present is forbidden: it is a second parser, and a second parser is this node's whole
  disease. Whether the split is eager-with-the-renderer or lazy-per-token is decided by the MEASURED
  route bundles after migration, not pre-committed here as policy.
- **`SpecBody` is a compatibility shell, then it is gone.** During the migration it forwards to the one
  renderer, passing the resolver and handlers its callers already have; it is DELETED once the four
  body surfaces are through. `NodeView`'s first-heading suppression stays a CALLER concern — the caller
  chooses which source text it hands over — and never becomes a renderer option.
- **The existing regressions MIGRATE; they are not re-derived.** The console's renderer already ships a
  unit suite over these guards and a browser suite that locks real text-node selection, composer focus,
  desktop and phone overflow, and a remote image actually decoding. Those tests move onto the unified
  renderer — a rewritten implementation that cannot satisfy them is wrong by definition, and re-deriving
  a second set of rules for the same behaviour is how the two dialects were born in the first place. The
  reusable TimelineChat selection/copy acceptance matrix and its oracle boundary are archived beside this
  node in `migration-payload.md`; the node's eval scenario points at the executable gate.
- **Expect OTHER nodes' fixtures to break on depth, and fix them semantically.** Rendering real Markdown
  makes a prose surface's DOM deeper: text that used to be the container's first child now sits inside a
  paragraph, an emphasis, a list item. Any existing test — in any node — that reaches into one of the four
  body surfaces by structural position (`firstChild` is a Text node, a fixed child index, a flat
  `textContent` shape) will break the moment that surface migrates, and it will break for the RIGHT
  reason. This already happened once to a neighbouring lane's composer suite. The honest repair is to
  address content by MEANING — the first non-empty descendant text, a queried role or class — never to
  loosen the assertion until it stops noticing anything; and where a test's own timing assumed a flat
  body (a count taken before history hydrated), it waits for the real data instead. Each surface's
  migration therefore budgets for its neighbours' fixtures, not only its own. Semantic addressing LOCATES
  content; it never SOURCES an expectation. The math-copy proof above stays anchored to author-written
  literals — a fixture whose expected text is read out of the rendered tree would be checking the engine
  against the engine's own output, and the triple-copy defect would sail through it.
- **Each migrated surface re-measures its own scenario.** The body surfaces carry eval scenarios that
  already assert rendered Markdown (headings/tables/lists, no raw `##` or pipes) and, for the thread,
  playing evidence media; every one of them is re-measured through the real browser as it moves, so the
  unification is proven surface by surface instead of claimed once.
- **The renderer boundary is reviewed by the engine's own node, per surface.** The console node that
  brought the parser holds review over the BOUNDARY and its invariants — not over any page's UX — and at
  minimum sees three commits: the core token tree with the first body surface, the thread's semantic
  tokens (where the pre-strip dies), and the timeline's final migration with the old path's deletion.
  Ownership of the migration and of each page's surface stays with this node; the boundary review is what
  keeps one renderer from quietly re-growing two dialects.
- **What this node deliberately does not add**: no HTML sanitizer, image allowlist, or remote-content
  policy beyond the parser's and KaTeX's own untrusted-source defaults; no syntax highlighter; no
  Markdown editor; no second message model; and no page-local escape hatch back into a private dialect.
