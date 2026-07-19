---
scenarios:
  - name: presence-facet-filters-both-pages
    tags: [frontend-e2e]
    code: [spec-dashboard/src/IssuesPage.jsx, spec-dashboard/src/EvalsFeed.jsx, spec-dashboard/src/session.js]
    description: >-
      Run the dashboard with sessions on the board behind some issues and eval readings. On each
      ListView open the overflow's Source session group, pick Present and then Missing, compare rows
      against the board's session ids, and read the visible query text and hash after each pick; clear
      with All. Repeat at 390px and after combining another token.
    expected: >-
      Both pages expose the same Source session radio group whose picks are token surgery: Present
      writes `session:present`, Missing `session:missing`, into the visible text and the ?q address as
      one PUSH; All removes the token. Issues retain exactly rows whose originator or a reply author
      still resolves to a board session; Evals retain exactly readings whose filer does — the ONE
      `sessionPresent` membership join, any zone, no liveness judgment and no live/online/offline
      wording anywhere on the facet. present|missing partition every entry. Back replays each state;
      the group stays usable in the mobile kebab with no horizontal overflow.
  - name: presence-facet-never-strands
    tags: [frontend-e2e]
    code: [spec-dashboard/src/EvalsFeed.jsx, spec-dashboard/src/IssuesPage.jsx]
    description: >-
      With `session:present` active, reduce the matching count to zero (combine tokens or use a board
      with no present sources). Reopen the overflow and clear the filter; also delete the token from the
      query text directly. Repeat on both pages.
    expected: >-
      At zero results the list shows the honest filtered-empty face while the Source session group stays
      mounted with All releasable — and the visible query text itself is always the canonical
      off-switch, so neither ListView can strand itself behind an invisible filter.
---
# measuring live-session-filter

YATU through the real ListViews against the real board: compare visible rows to /api/sessions membership,
drive the real overflow menu, the visible query text, and browser history; repeat after data contracts.

