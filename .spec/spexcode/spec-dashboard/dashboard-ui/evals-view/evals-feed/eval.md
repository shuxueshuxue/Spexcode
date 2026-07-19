---
scenarios:
  - name: feed-current-loss-listview
    tags: [frontend-e2e]
    description: >
      With fresh video/image readings, stale readings, and at least one human-ok'd reading, open #/evals
      in a real browser. Read the query/header/rows, current and reviewed counts, media element count,
      row hrefs, state SVGs, and /api/graph requests; open a video row.
    expected: |
      The list is one GitHub-style ListView over latest-per-scenario rows: 32px query, Current/Reviewed
      counted sections, real facets, ~64px desktop structured anchors. Each `.rl-row-grid` leads with the
      shared verdict icon, then scenario title, node/filer/time metadata, and kind/scope facts. Fresh
      human-ok'd readings alone belong to Reviewed; everything else remains Current, newest-first. The
      list mounts zero video/image elements and fires zero extra /api/graph reads; media exists only after
      the real anchor opens the standalone detail page. The list state icon matches that detail's icon for
      the same verdict.
  - name: verdict-freshness-kind-facets-are-honest
    tags: [frontend-e2e]
    description: >
      Open #/evals against mixed pass/fail, fresh/stale, video/image/mixed/note readings. Open the
      Verdict, Freshness, and Evidence menus, pick values, and compare each option/result against
      /api/graph and the visible query text. Combine picks, inspect the empty state and both tab counts,
      then clear via All.
    expected: |
      Menus are pure query builders: a pick writes its verdict:/freshness:/evidence: token into the
      visible text and pushes; All removes the token. Options map only real reading fields: verdict reads
      pass/fail/unscored, freshness the live fresh bit, evidence the reading's kind SET (a mixed reading
      matches each carried kind; the default is all with no data-dependent fallback) and all returns
      non-media readings too. Stale readings stay in the default Current list, never silently hidden.
      Blind rows match their node/unscored/query facts but disappear under evidence, freshness, filer, or
      source-session presence tokens because they own no reading facts; they remain inert when visible,
      and they keep counting toward the Current tab even while Reviewed is displayed (counts are
      rest-of-query). Combined tokens are conjunctive and an honest zero says no evals match this view
      (not that none exist) while all chrome stays releasable. No list media request or fake menu appears.
  - name: token-dimensions-and-overflow
    tags: [frontend-e2e, desktop, mobile]
    description: >
      With readings across nodes/filers and sessions on the board, type node:/filer:/scope: prefixes into
      the query and walk the inline suggestions; submit hand-typed unknown and historical values. Inspect
      desktop direct menus and the functional overflow, then repeat at 390px. Compare row sets and hashes.
    expected: |
      Node, filer, and scope are TOKEN-ONLY dimensions: no enumerating dropdown exists for any of them;
      suggestions are bounded to values present in the data — scope to sessions on the current board — and
      an unknown or historical value still submits verbatim to the honest zero. Desktop keeps the
      low-cardinality verdict/freshness/evidence menus direct and source-session presence in the
      functional overflow. At 390px only Verdict remains direct; freshness/evidence plus presence are
      usable in the kebab. Suggestion labels may be compact but the completed token writes the full id
      into the visible query. No menu or row widens body/document past 390px.
  - name: filters-live-in-the-url
    tags: [frontend-e2e, desktop]
    description: >
      Open #/evals and record history.length. Edit and submit the query text, pick verdict/freshness/
      evidence from menus, select Reviewed, and add a scope: token; read hash/history after each. Reload,
      then drive Back one state at a time.
    expected: >
      Every human edit, section, or menu change pushes the ONE canonical address — bare for the default
      view, ?q=<raw token text> otherwise. Reload replays the exact text, section, menu checkmarks,
      counts, and row set; each browser Back restores the previous state exactly, text included. No
      component-local filter state survives outside the address.
---
# evals-feed loss

YATU through the real browser over a live backend: drive the actual query, sections, facet menus, overflow,
row anchors, and Back history; inspect DOM geometry, media requests, and screenshots. Helpers are auxiliary.
