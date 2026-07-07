---
scenarios:
  - name: live-chip-filters-both-pages
    tags: [frontend-e2e]
    code: [spec-dashboard/src/IssuesPage.jsx, spec-dashboard/src/EvalsFeed.jsx, spec-dashboard/src/session.js]
    description: >-
      Run the dashboard against a backend whose board lists at least one LIVE session that has filed an
      issue and yatsu readings (a real dispatched worker works). On #/issues read the chip row: the "N
      live" chip's presence and count; click it and compare the row set before/after against the board's
      live session ids (issue originator or reply authors); click again to release. Repeat on #/evals for
      the feed (a reading's filer `by`). Check both chips sit on the SECOND row with the concluded chip's
      ef-chip look and toggle styling.
    expected: >-
      Both pages carry an "N live" ef-chip on the head's chip row (never the control row), rendered only
      while N > 0. Toggling it narrows the issues list to exactly the issues whose originator or a reply
      author is a live board session, and the evals feed to exactly the readings whose filer session is
      live — the same set the originator chips' alive dots mark, never a second judgment. Toggling off
      restores the full list. The chip highlights while on (the concluded chip's `on` styling), and a
      deep link to a hidden entry still renders it (the chip releases). No page errors.
---

# measuring live-session-filter

YATU through the real running dashboard with a genuinely live session on the board — never by reasoning
about liveSession's code. The proof compares the chip-filtered row set against the board's own session
list on BOTH pages, so the one-judgment claim (chip == originator dots) is measured, not assumed.
