---
title: transcript-ui
status: active
hue: 205
desc: The published React components that draw a normalized transcript — the person quoted, the agent as the page, a tool call as a sentence, the work folded behind its answer — with the fold, the prose renderer, the tool vocabulary, the labels and the design tokens all tunable by the host.
code:
  - packages/transcript-ui/src/index.ts
related:
  - packages/transcript-ui/package.json
  - packages/transcript-ui/styles.css
  - packages/transcript-ui/src/context.tsx
  - packages/transcript-ui/src/vocabulary.ts
  - packages/transcript-ui/src/segments.ts
  - packages/transcript-ui/src/ToolLine.tsx
  - packages/transcript-ui/src/Quote.tsx
  - packages/transcript-ui/src/icons.tsx
  - packages/transcript-ui/src/useDisclosure.ts
  - packages/transcript-ui/src/useTranscriptFrames.ts
  - packages/transcript-ui/src/render.test.tsx
  - spec-dashboard/src/Transcript.jsx
  - spec-dashboard/src/main.jsx
---
# transcript-ui

`@spexcode/transcript-ui` is the transcript's grammar as components: [[transcript-view]] draws one interval's
turns and [[message-stream]] its collapsed live face, over the normalized shape and frame protocol of
[[transcript]]. The grammar was designed and measured in SpexCode's own conversation surface
([[conversation]]) and is published so another product driving the same harnesses draws the same
conversation — SpexCode's dashboard is its first adopter, binding it through one thin module
(`spec-dashboard/src/Transcript.jsx`) that supplies only what is this product's.

**Every tunable has one home: `TranscriptUi`.** A host wraps its surface once and the components read the
context instead of threading props: `renderText` (prose → elements; the default keeps the writer's line
breaks and paragraphs and renders nothing else, a host with a markdown pipeline passes it and the same
renderer serves every turn, quote and note), `loadToolOutput` (where a withheld live body is fetched from —
absent means every body is inline), `labels` (the few words the surface says, in the host's language),
`vocabulary` (the verbs, quiet set and target keys that turn a call into a sentence — DATA a host extends
with `extendVocabulary`, never a branch on a harness id), `fold` (`segments` | `runs` | `none`), `runMin`, and
`userTurns` (`boundary`: a person's turn ends a run of work and is not drawn, for a host whose own record
already shows every message; `quote`: it is drawn as a bubble, for a host where the transcript is the whole
conversation). Nested providers override only what they pass, so a seam can set its loader without
restating the outer binding.

**Frames come in through `useTranscriptFrames`.** The hook hands every frame a transport delivers — SSE, IPC,
a socket — to the protocol's own `mergeTranscriptFrame` and returns one complete payload; a host writes no
merging code and cannot drift from the producer.

**One stylesheet, tokens with a fallback chain.** `styles.css` is the whole visual grammar under a `.tx-`
prefix. Every colour, face, size and space is a `--tx-*` token that falls back to the same-named bare token
a host may already define (`--ink`, `--mono`, `--type-prose`, …) and then to a dark default: a host that
defines nothing gets a finished surface, SpexCode's dashboard is inherited automatically, and a host that
wants something else sets `--tx-*` on any ancestor. Class names are the second, stable customisation
surface. The two marks the grammar needs — the chevron trailing every disclosure and the spinner on a running
call — are inline stroke SVG; there is no emoji and no icon font anywhere in the package.

**What stays out.** No transport, no session, no harness id, no i18n framework, no markdown dependency, no
global CSS reset. React is a peer (`^18 || ^19`); the Node floor is 18 like [[transcript]]'s. Tests render
through `react-dom/server`, so the grammar is proven without a browser, and the host's e2e proves the binding.
