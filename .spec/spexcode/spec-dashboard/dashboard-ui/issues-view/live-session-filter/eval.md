---
scenarios:
  - name: live-facet-filters-both-pages
    tags: [frontend-e2e]
    code: [spec-dashboard/src/IssuesPage.jsx, spec-dashboard/src/EvalsFeed.jsx, spec-dashboard/src/session.js]
    description: >-
      Run the dashboard with a genuinely live session behind issues and eval readings. Open each ListView's
      overflow, pick Live, compare rows against board session ids, read hash/history, then clear with All.
      Repeat at 390px and after combining another facet.
    expected: >-
      Both pages expose the same functional Live facet and write `?live=1` as a PUSH. Issues retain exactly
      rows whose originator or reply author is live; Evals retain exactly readings whose filer is live —
      identical to detail liveness dots because all consume `liveSession`. All restores the prior population;
      Back replays each state. Live remains usable in mobile kebab with no horizontal overflow.
  - name: live-facet-survives-filer-death
    tags: [frontend-e2e]
    code: [spec-dashboard/src/EvalsFeed.jsx, spec-dashboard/src/IssuesPage.jsx]
    description: >-
      Select Live, then close the only live session so the matching count becomes zero. Reopen overflow and
      clear the filter; repeat on both pages.
    expected: >-
      While `?live=1` is active, Live remains present even at zero results and All can release it. Once off
      with no live data, the no-data facet may disappear. Neither ListView can strand itself empty.
---
# measuring live-session-filter

YATU through the real ListViews and a genuinely live board session: compare visible rows and detail dots to
the board, drive the real overflow menu and browser history, and repeat after the session leaves the board.
