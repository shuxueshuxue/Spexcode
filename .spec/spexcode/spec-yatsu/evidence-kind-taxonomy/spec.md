---
title: evidence-kind-taxonomy
status: active
hue: 275
desc: A yatsu evidence entry's `kind` is a MEDIA/RENDER type — how the bytes are shown — kept orthogonal to the step-map axis. Structured machine data earns its own honest `data` kind, derived from content, rendered as a validatable data block instead of being flattened into a transcript.
related:
  - spec-yatsu/src/sidecar.ts
  - spec-yatsu/src/cli.ts
  - spec-yatsu/src/evaltab.ts
  - spec-yatsu/src/filing.ts
  - spec-yatsu/src/proof.ts
  - spec-dashboard/src/Evidence.jsx
  - spec-dashboard/src/EventDetail.jsx
  - spec-dashboard/src/EvalsFeed.jsx
---
# evidence-kind-taxonomy

An evidence entry's **`kind`** answers ONE question: how are these bytes shown? It is a media/render
taxonomy — `image` (a still), `transcript` (free-form text), `video` (a moving picture), `data` (a
structured machine export). That is a different question from *what axis a step can anchor to*, which
[[step-timeline]] derives from the kind and [[yatsu-core]] keeps as its own concern. The two were once
welded — a `video` meant "a screenshot WITH a time axis" — and this node holds them apart: kind is
render, axis is position, and the one seam between them is a per-kind map, never a conflation.

**Structured data is evidence, and it deserves an honest kind.** A benchmark's `--export-json`, an API
payload, a metrics dump is not a wall of terminal text — it is a machine artefact that can be *parsed and
checked*. Before, the only text channel was the transcript, so a JSON export was filed as one and rendered
as scrolling monospace, indistinguishable from a log — the "this is structured, validate it, show it as
data" truth had no way to be told. `data` is that truth. It renders as a labelled data block (pretty-printed
when it parses, shown raw with an *invalid JSON* marker when it doesn't — so a broken export is visibly
broken, never silently a paragraph), and its step-map axis is the record ordinal (`index`).

**The kind follows the bytes, not the flag.** An author still picks a filing flag by intent — a captured
result goes to `--result` — but whether that result is `transcript` or `data` is decided by *what the bytes
are*, sniffed from content. One predicate answers "is this a structured JSON blob?" and it is the SINGLE
source two places read: the blob route's MIME sniff (so the served content-type is `application/json`) and
the filing path (so the stored kind agrees). Because both derive from the same sniff, the kind recorded on
an entry and the type served for its bytes can never drift apart — and the dashboard's bare-hash renderer,
which already resolved a kind from the served content-type, now resolves `data` for free. No new flag an
agent must remember to reach for (a capability nobody is told to use decays into a dead enum); the honesty
is automatic.

**The floor is preserved.** `image`, `transcript`, and `video` render exactly as before through the one
shared evidence renderer; `data` is a fourth arm beside them, not a replacement. A legacy reading, a
pruned blob's *miss* sentinel, the self-contained proof export, the eval feed's kind chips — every home
that lists or shows evidence gains the new kind without losing the old ones. Adding a render kind is a
small, closed change: one entry in the taxonomy, one arm in each renderer, one row in the axis map.
