---
title: paged-review
status: active
hue: 205
desc: The server half of review-chrome's ONE Issues paging protocol — stable source projection and revision, shared query matching, full-set counts/facets, then one 25-row slice.
code:
  - spec-cli/src/reviews.ts
related:
  - spec-cli/src/index.ts
  - packages/spec-core/src/review/reviewFilters.js
  - packages/spec-core/src/review/reviewQuery.js
---

# paged-review

The Issues pages consume one server paging operation. A request names the committed token query and a
positive page; `perPage` is the product constant 25. The canonical Issues list, the node Issues pane and the
context dock all consume the same response protocol. The source first becomes one deterministic ordered
population under one stable revision: merged local/forge Issues are newest-first with an id tie-break.
Session presence is joined before matching; a source failure remains loud rather than turning into an empty
response.

The server imports [[review-filters]] and [[review-query]] directly. There is no server copy of tokenization,
qualifier mapping, or field predicates. It applies source selection, matching, section counts, and facet
derivation over the complete population, then slices exactly once. The response is the shared
`{items,page,perPage,total,sourceTotal,pageCount,prev,next,revision,counts,facets,section}` shape plus
bounded domain metadata (issue enablement and write stores). `sourceTotal` distinguishes a vacant source
from a filtered-zero view. `items.length <= 25`; neither a hidden full collection nor a second full-list
field rides beside it. No page composes a manager gate; conflict, lint, ahead, and committed remain
together on explicit review.

An Issues `label:` query is ordinary shared filtering: label-chip interaction changes only the committed
token text, then this same operation derives matching rows, counts, facets, and the next 25-row slice.

A `counts` entry is one number, or the named buckets of a section the adapter SPLIT. Either is that
section's whole population, folded HERE, once, over the complete filtered set before the slice, so a browser
holding 25 rows never re-derives it; `section.options[].count` keeps carrying the same sections' whole
totals for the compact menu faces. The canonical list and the node pane speak this one shape.

A requested positive page beyond `pageCount` is preserved and returns HTTP 200 with empty items. Previous
and Next continue to requested-1/requested+1 in that overflow state; an in-range last page has no Next.
Missing/invalid/non-positive input repairs to page 1. Source failures are loud and distinct from an honest
empty slice. The revision hashes only stable, observable source/filter inputs, never wall-clock generation
time, so count and slice identify the same snapshot and an unchanged request remains cacheable.

The current Issue population is published as a server-only atomic [[review-snapshot]] during graph
assembly, then omitted from graph serialization; review requests reuse that snapshot rather than rebuilding
or crawling it.

Forge resident refresh may use native host pagination and incremental windows at the adapter boundary; a
browser review request reads that resident snapshot and never starts a host-wide or per-row N+1 crawl. When
the content of ANY issue store this read merges advances after a snapshot publication, the next Issue read
requests a graph publication that has reached at least that content revision on every store before paging.
Every store is asked, not just the resident forge one: a store left out of that comparison is a store whose
writes this page cannot see, so its own close would stay visible in the list until an unrelated rebuild
happened to republish. A held graph flight that captured older source state cannot satisfy the request;
source state already at the required revision stays on the cached snapshot path.

Issue detail remains a separate single-object `/api/issues/:id` read and
never falls back to graph or list rows.
