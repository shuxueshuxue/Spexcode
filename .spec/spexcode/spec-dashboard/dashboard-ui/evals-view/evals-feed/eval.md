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
      Open #/evals against mixed pass/fail, fresh/stale, video/image/mixed/note readings. Open Verdict,
      Freshness, and Evidence facets and compare each option/result against /api/graph. Combine facets,
      inspect empty state, then clear them.
    expected: |
      Facets map only real reading fields: verdict reads pass/fail/unscored, freshness reads the live fresh
      bit, kind matches the reading's evidence SET (a mixed reading matches each carried kind), and all
      returns non-media readings too. Stale readings are present in the default Current list, never silently
      hidden. Blind rows match their node/unscored/query facts but disappear under kind, freshness, filer,
      or Live because they own no reading facts; they remain inert when visible. Combined facets are
      conjunctive and an honest zero-result says no evals match this view (not that no evals exist) while all
      chrome remains releasable. No list media request or fake facet appears.
  - name: node-filer-scope-live-overflow
    tags: [frontend-e2e, desktop, mobile]
    description: >
      With readings across nodes/filers and live sessions, inspect desktop direct facets and overflow, then
      repeat at 390px. Pick node, filer, merged/session scope, and live values; compare row sets and hashes.
    expected: |
      Node, filer, live-session join, and session scope filter their real fields. Desktop keeps common facets
      direct and low-frequency filer/scope/live in functional overflow. At 390px only Verdict remains direct;
      freshness/kind/node plus filer/scope/live are usable in kebab. Long UUID values are compact display
      labels but write the full id into canonical query. No menu or row widens body/document past 390px.
  - name: filters-live-in-the-url
    tags: [frontend-e2e, desktop]
    description: >
      Open #/evals and record history.length. Submit a query, pick verdict/freshness/kind, select Reviewed,
      and choose a session scope; read hash/history after each. Reload, then drive Back one state at a time.
    expected: >
      Every human query, section, and facet change writes canonical hash query as a history PUSH. Reload
      replays the exact query text, selected section/facets, counts, and row set; each browser Back restores
      the previous state exactly. No component-local filter state survives outside the address.
---
# evals-feed loss

YATU through the real browser over a live backend: drive the actual query, sections, facet menus, overflow,
row anchors, and Back history; inspect DOM geometry, media requests, and screenshots. Helpers are auxiliary.
