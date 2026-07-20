---
title: paged-review
status: active
hue: 205
desc: The server half of review-chrome's ONE Issues/Evals paging protocol — stable source projection and revision, shared query matching, full-set counts/facets, then one 25-row slice.
code:
  - spec-cli/src/reviews.ts
related:
  - spec-cli/src/reviews.test.ts
  - spec-cli/src/index.ts
  - spec-dashboard/src/reviewFilters.js
  - spec-dashboard/src/reviewQuery.js
  - spec-eval/src/sessioneval.ts
---

# paged-review

Issues and Evals share one server paging operation. A request names domain, committed token query, and a
positive page; `perPage` is the product constant 25. Canonical current lists, scoped Evals, the node Issues
pane, the node Eval timeline mode, and search-palette review planes all consume the same response protocol.
The domain source first becomes one deterministic
ordered population under one stable revision: merged local/forge Issues are newest-first with an id
tie-break; trunk Evals are current declared scenarios' latest readings; scoped Evals are the worktree model's
blind rows, session-owned readings, then inherited readings. Session presence is joined before matching.

The server imports [[review-filters]] and [[review-query]] directly. There is no server copy of tokenization,
qualifier mapping, or field predicates. It applies source selection, matching, section counts, and facet
derivation over the complete population, then slices exactly once. The response is the shared
`{items,page,perPage,total,sourceTotal,pageCount,prev,next,revision,counts,facets,section}` shape plus
bounded domain metadata (issue enablement/write stores; scoped eval gates/unknown coverage). `sourceTotal`
distinguishes a vacant source from a filtered-zero view. `items.length <= 25`; neither a hidden full
collection nor a second full-list field rides beside it.

A requested positive page beyond `pageCount` is preserved and returns HTTP 200 with empty items. Previous
and Next continue to requested-1/requested+1 in that overflow state; an in-range last page has no Next.
Missing/invalid/non-positive input repairs to page 1. Source failures are loud and distinct from an honest
empty slice. The revision hashes only stable, observable source/filter inputs, never wall-clock generation
time, so count and slice identify the same snapshot and an unchanged request remains cacheable.

The current Issue/Eval populations are published as a server-only atomic [[review-snapshot]] during graph
assembly, then omitted from graph serialization; review requests reuse that snapshot rather than rebuilding
or crawling it. Node timeline mode loads only its addressed node before filtering/slicing.

Forge resident refresh may use native host pagination and incremental windows at the adapter boundary; a
browser review request reads that resident snapshot and never starts a host-wide or per-row N+1 crawl.

The same protocol family owns Eval detail without reopening a full-list channel. One bounded detail request
names `(scope?, node, scenario)` and returns the selected current row, that scenario's complete newest-first
A/B history, metadata, a stable response revision, and a Continue Reviewing projection containing at most five
lightweight `{node,scenario,state}` neighbors plus source `total`, zero-based `index`, and the named `default`
order. Neighbor groups preserve the source's stable list order, nearest to the selected row first, with the
forward side taking the odd slot and boundary capacity refilling from the other side. No other scenario's
history or reconstructable row rides the response. Trunk detail reads the server-only atomic review snapshot;
scoped detail projects the worktree engine and also returns its summary and
`evalRevision {epoch,generation,content}`. A browser that has observed a newer graph projection discards and
retries the old response; equal generations require equal content revisions. The session HTML export is the
only full-model transport exception. Issue detail remains a separate single-object `/api/issues/:id` read and
never falls back to graph or list rows.
