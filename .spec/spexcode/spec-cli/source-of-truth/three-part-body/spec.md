---
title: three-part-body
status: active
hue: 160
desc: A spec body has two labelled parts — raw source (human) · expanded spec (agent); current state is DERIVED, never narrated.
---

# three-part-body

## raw source

A spec body is hard to keep honest when one blob of prose mixes the human's intent and the agent's
detailed reading of it. **Split it into two parts with two owners.** (1) **RAW SOURCE** is the human's
raw intent/decisions — very short, rarely changed, and changing it needs **human approval**. (2)
**EXPANDED SPEC** is the agent's detailed behavioral understanding — *not* implementation — versioned
freely, but it must always still match the raw source.

There is deliberately **no agent-authored "current state" part**. An agent narrating what's-done
hallucinates completion, so the node's progress must be **DERIVED, never narrated**: the derived
4-state status (pending/active/merged/drift), the version count, and the drift figure already answer
"what's done" from git — facts, not prose. Keep the body a living document — no `## vN` headings.

## expanded spec

The two parts are clearly-delimited markdown sections in `spec.md`, so a human reading the raw file
and an agent reading `/api/specs` see the same structure:

- `## raw source` — part 1.
- `## expanded spec` — part 2. May carry its own `###` subsections for structure; they are content of
  this part, not new parts.

The backend parser (`parseParts` in `specs.ts`) is fence-aware and matches **exactly** two-hash
headings for the two part names. A body that uses neither heading parses to `null`, and every existing
one-blob spec keeps rendering whole — the structure is **opt-in, never forced**. Because the part names
are structure headings (not `## vN` changelog headings), `spex lint`'s **living** rule stays satisfied
and the feature ships at 0 errors.

`loadSpecs()` attaches `parts` (`{ rawSource, expandedSpec }` or `null`) to each node, and `/api/specs`
exposes it verbatim. The dashboard `NodeView` renders each part as its own card with an **owner badge**
(human vs agent) and a stability note, so the reader sees who owns each part and how often it changes;
legacy `null`-parts nodes fall back to the whole-body view. The NodeView meta line already carries the
derived status, version, and drift — that is where "what's done" is read, so there are no progress or
self-assessment cards to render and the parser carries no `currentState` field.

This is a **cross-cutting contract**, not a code-owning node: it governs no source file of its own. Its
two halves live where their primary concern does — `parseParts` rides in `specs.ts` ([[source-of-truth]],
the loader/aggregator) and the `TwoPart` card rendering in `NodeView.jsx` ([[work-pane]], the node popup).
Listing neither here is deliberate: a change to the loader or the popup is *their* node's drift, never a
phantom warning on this body-structure contract.
