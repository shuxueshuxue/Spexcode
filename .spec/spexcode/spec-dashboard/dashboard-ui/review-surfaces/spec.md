---
title: review-surfaces
status: active
hue: 205
desc: The Issues pages as ONE paged-review product — the page family plus the shared chrome, filter engine, and thread it renders through, each kept in its own node so the page cannot grow a private dialect of them.
---
# review-surfaces

`#/issues` is one rail destination read as one product: a GitHub-grammar LIST page whose whole state is a
visible token query in its URL, rows that are real anchors, a click that PUSHES onto a standalone DETAIL
page, and browser Back as the return path. That shape once proved its drift risk as two master-detail copies
of one idea, so the shared middle is not an afterthought that happened to be extracted — it is why this
group exists, and it is why the page reads correctly only beside it.

- [[issues-view]] — the Issues pages: Open/Closed lifecycle over the merged store, a detail whose writes
  route to the issue's own store, and a routed compose page with the same standing as reading one.
- [[review-chrome]] — the ONE contract the page renders through: the paged-review request/response shape,
  the ListView query/section/facet/pagination chrome, the row and state primitives, and the standalone
  `DetailShell`.
- [[review-filters]] — the ONE pure filter engine with domain adapters, the single home of field
  semantics, serving the canonical list and the compact embedded panes from the same predicates.
- [[reply-thread]] — the ONE thread the detail renders, so a local thread and a forge thread are the same
  component carrying the same marks.

The line this group holds: a change to list rhythm, query grammar, detail geometry, field meaning, or the
thread lands **once**, in the shared node, and the page moves with it. What stays in the page is only what
genuinely differs — the issue lifecycle. The page may not grow a near-copy of the shared middle, and the
shared middle may not grow a page-specific domain branch; an empty abstraction that exists only to be
parameterized by which page called it is the same failure from the other side.

This node owns no source of its own — each child keeps its files, `[[links]]`, and drift.
