---
title: node-attachments
status: active
hue: 190
desc: The rest of a spec node's folder — everything it carries besides its body and its readings, listed and read through the node itself.
code:
  - spec-cli/src/spec-attachments.ts
related:
  - spec-cli/src/source-read.ts
  - spec-cli/src/index.ts
  - packages/spec-core/src/specs.ts
---
# node-attachments

A spec node has always been a **folder**, and the board could see exactly one file in it. Everything else a
node carries — its eval contract, an evidence directory, a raw capture, a reproduce script, a working note
written beside the spec that cites it — existed on disk and nowhere in the product. In this repository that
is several hundred files: authored, committed, cited in prose, and unreachable from the surface that shows
the prose citing them.

`GET /api/specs/:id/files` lists them and `…/files/content` reads one as a window. Both are reached through
the **node's id**, never a repo path, because the folder belongs to the node — an attachment has no meaning
apart from the node that carries it.

**This is deliberately not the governed-source surface, and the reason matters.** [[source-read]] answers to
the project's coverage policy, and that policy excludes `.spec/**` on purpose: the spec tree is the
product's own data, not code it governs. Reaching these files by loosening that predicate would have
destroyed the one invariant that keeps *what the product shows* and *what the product governs* the same
set. So the **gate is different and the windowed read is shared** — which is the right way round. Two
surfaces may disagree about what may be read; they must not disagree about what `bytes` means.

**Two files are excluded because they already have better surfaces.** `spec.md` is the node's document and
`evals.ndjson` is its eval timeline; listing them here would offer a second, worse way to read what the
board already renders well. Asking for one by name is refused with that reason rather than served.

**Containment is checked by resolving, not by pattern-matching.** The name is joined and then tested for
containment, so a `..` that normalises back inside is fine and one that escapes is caught wherever it came
from. An absolute name is refused outright: `join` would silently reinterpret it as relative, containment
would still hold, and the caller would get a confusing answer about a path it did not mean.

**An error names what the caller asked about, never where the checkout lives.** Node puts the absolute path
it tried to open into the exception message, and these strings are API responses; only the error code
crosses the boundary. This was found by exercising the refusal paths rather than the happy one, and it was
present on the source surface too.

Listing walks the folder recursively and is bounded on both depth and count, so a node that accumulates an
evidence dump degrades into a long list rather than a wedged read. `specDir` — the spec tree's own answer
to *where does this node live* — belongs to the loader rather than being re-derived from an id by every
caller that needs it.
