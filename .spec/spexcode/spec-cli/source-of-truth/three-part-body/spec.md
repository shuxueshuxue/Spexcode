---
title: three-part-body
status: active
hue: 160
desc: A spec body has three labelled parts — raw source (human) · expanded spec (agent) · current state (agent).
code:
  - spec-cli/src/specs.ts
  - spec-dashboard/src/NodeView.jsx
  - spec-dashboard/src/styles.css
---

# three-part-body

## raw source

A spec body is hard to keep honest when one blob of prose mixes the human's intent, the agent's
detailed reading of it, and a report on the code. **Split it into three parts with three owners.**
(1) **RAW SOURCE** is the human's raw intent/decisions — very short, rarely changed, and changing it
needs **human approval**. (2) **EXPANDED SPEC** is the agent's detailed behavioral understanding —
*not* implementation — versioned freely, but it must always still match the raw source. (3) **CURRENT
STATE** is the agent's report on the code: a **description** of what the code does now / progress /
what's unimplemented, and a **verdict** arguing why code & spec are not drifted and confirming the
code did not drive the spec backward. Keep this a living document — no `## vN` headings.

## expanded spec

The three parts are clearly-delimited markdown sections in `spec.md`, so a human reading the raw file
and an agent reading `/api/specs` see the same structure:

- `## raw source` — part 1.
- `## expanded spec` — part 2. May carry its own `###` subsections for structure; they are content of
  this part, not new parts.
- `## current state` — part 3, holding two `###` pieces: `### description` and `### verdict` (the
  matcher keys on the leading word, so `### verdict — not drifted` still counts).

The backend parser (`parseParts` in `specs.ts`) is fence-aware and matches **exactly** two-hash
headings for the three part names; a `###` only switches the current-state piece. A body that uses
none of these headings parses to `null`, and every existing one-blob spec keeps rendering whole — the
structure is **opt-in, never forced**. Because the part names are structure headings (not `## vN`
changelog headings), `spex lint`'s **living** rule stays satisfied and the feature ships at 0 errors.

`loadSpecs()` attaches `parts` (`{ rawSource, expandedSpec, currentState: { description, verdict } }`
or `null`) to each node, and `/api/specs` exposes it verbatim. The dashboard NodeView renders each part
as its own card with an **owner badge** (human vs agent) and a stability note, so the reader sees who
owns each part and how often it changes; legacy `null`-parts nodes fall back to the whole-body view.

## current state

### description

Implemented end to end. `specs.ts` adds the `SpecParts` type, `PART_ALIASES`, and `parseParts(body)`
(fence-aware, two-hash part headings, lenient `###` description/verdict matching), and `loadSpecs()`
returns `parts` on every node (`null` for legacy bodies). The route `/api/specs` already returns
`loadSpecs()` verbatim, so the three parts ride out over HTTP with no extra wiring. In the dashboard,
`NodeView.jsx` gains `ThreePart` / `PartCard`, and `SpecPane` switches on `node.parts` — three labelled
cards with human/agent owner badges and the current-state description/verdict split, or the old
whole-body render when `parts` is null. `styles.css` styles the cards and badges. The `sessions` node
is converted as the first worked example. Not yet: no enforcement that a converted node fills all three
parts (an empty part renders empty, it is not a lint error), and the human-approval gate on editing the
raw source is a convention, not yet a hook.

### verdict — not drifted

All three governed files were written and committed together in this node's first version, so none is
ahead of the spec (drift 0 — `spex lint` reports 0 errors and no `drift` warning for this node). The
expanded spec states the intended structure and parser contract as behavior; the description above is
the separate, honest account of how the code meets it, including the two admitted gaps (no
all-parts-present enforcement, approval-gate still a convention). Those gaps live in **description**,
not back-written into the **expanded spec**, and the expanded spec still satisfies the **raw source** —
which is the proof the code did not drive the spec in reverse.
