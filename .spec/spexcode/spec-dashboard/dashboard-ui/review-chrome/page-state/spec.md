---
title: page-state
status: active
hue: 205
desc: The client half of paged review — one request hook and GitHub-shaped page-window projection shared by Issues and Evals, with URL history remaining the state owner.
code:
  - spec-dashboard/src/reviewPage.js
related:
  - spec-dashboard/src/reviewPage.test.mjs
  - spec-dashboard/src/ReviewShell.jsx
  - spec-dashboard/src/reviewQuery.js
  - spec-dashboard/src/route.js
---

# page-state

The browser's review client fetches exactly one server page for the route's committed q+page, drops stale
responses, exposes loading/failure distinctly, and refreshes the same request after writes, board frames,
or the bounded cold interval. The loading state belongs to a NEW request identity (domain/q/page/view)
only: a same-request refresh — a board delta, the cold poll, a write's reload, a re-enable on return from
a detail — runs quietly behind the painted rows, and an answer whose revision matches the shown one
repaints nothing. It owns no item matcher and no private filter/page state: the hash route is replayed on
every Back/Forward/direct open, while [[paged-review]] returns the source snapshot and current slice.
Concurrent consumers or React's development remount join one in-flight request for the identical endpoint;
they do not double-pay the same page bytes. A later navigation may request that page again because it is a
new user action, not a hidden app-resident row cache.

The shared page-window projection yields the GitHub Issues number rhythm: all pages for a short set, a
leading or trailing eight-page window near an edge, and two edge pages around ellipses for a large middle.
It never changes navigation itself; [[review-chrome]] renders the projection as real anchors.
