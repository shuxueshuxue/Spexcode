---
title: transcript
status: active
hue: 205
desc: The published transcript package — one parser per harness, a bounded interval reader over a native thread file or an in-memory event stream, and the full/delta frame protocol every transport and renderer share.
code:
  - packages/transcript/src/index.ts
related:
  - packages/transcript/package.json
  - packages/transcript/tsconfig.build.json
  - packages/transcript/src/turns.ts
  - packages/transcript/src/parsers.ts
  - scripts/build-workspaces.mjs
  - scripts/release-publish.mjs
  - spec-cli/package.json
  - spec-dashboard/package.json
---
# transcript

`@spexcode/transcript` answers one question for any agent harness: *what happened in this thread between `from`
and `to`?* — as a small normalized turn stream (user and assistant prose, tool calls with their input, and each
call's output once the harness recorded it), and it carries that answer to a renderer as frames. It is the
product's own transcript seam ([[transcript-reader]] behind the [[harness-adapter]]'s `transcript` field,
[[session-transcript]] over SSE, the dashboard's tail seam) published so that another product driving the same
harnesses can read and render the same conversation without copying a line of it. SpexCode is its first adopter,
not its owner's only customer, so nothing in it knows a session record, a project root, a dashboard, or a
transport.

**Three parts, one type.** `turns.ts` is the normalized shape and the three reader verbs (`revision` / `read` /
`tail`) — pure TypeScript, no Node. `parsers.ts` is one parser per harness plus the interval collector: a parser
turns one native record into one normalized event, and never learns whether that record was read from a file or
handed over from memory. Two sources implement the reader verbs over those parsers: [[transcript-reader]] over
the native thread file each harness writes, and [[live-transcript]] over the native events a headless controller
already holds. [[transcript-frames]] is the wire: what a subscriber receives from an open interval, when a frame
is worth sending, and how the subscriber merges it back — producer and consumer halves in one module.
[[transcript-ui]] is the sibling package that draws what this one reads.

**Two entries.** `.` is the Node entry and exports everything. `./frames` exports only `turns.ts` and
`frames.ts`, whose module graph has no `node:` import, so a browser bundle or an Electron renderer merges frames
with the exact code that produced them — the way `@spexcode/spec-core` exposes its browser-safe review and
graph-delta entries ([[packaging]]). No source-file subpath is exported.

**Node 18 is the floor.** The package is meant for adopters that embed a Node runtime they do not choose — an
Electron main process is Node 18 today — so `engines.node` is `>=18` and `tsconfig.build.json` compiles against
`lib: ES2022`, which makes the compiler refuse an ES2023 API (`toSorted`, `findLast`, …) instead of leaving the
adopter to discover it at runtime. The rest of the repository stays at Node 22; this package is the one that
carries the older floor, and any code moved into it pays that bar on arrival.

**The frame protocol has one home.** An adopter's spec names the npm version it depends on and never restates
what a frame holds; a second description of the wire is a second truth that will drift. Inside this repository
the same rule holds by construction: the server route and the dashboard both import the protocol, neither
carries a copy.

**What stays out.** Nothing here resolves a session to a thread (that is the adapter's `exactNativeTargetId`),
launches a harness, decides which parser a session uses, or persists anything. The transcript remains a payload,
never a field in `timeline.ndjson` or `runtime.json`. A harness's parser is a data row — adding a harness adds one
parser and its locator, never one reader per surface.
