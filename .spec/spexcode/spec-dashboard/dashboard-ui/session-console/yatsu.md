---
scenarios:
  - name: close-tab-fallback
    description: >
      Through the running dashboard in a real browser, open the session interface (Enter) with at least
      two live sessions, A and B. Two passes. PASS 1 — select A's tab, click the header Close button, and
      watch where the view lands. PASS 2 — select A's tab, click Close, then immediately switch to B's tab
      while the close request is still in flight, and watch whether the view stays put. Measure by
      screenshotting the tab list + active pane before and after each close.
    expected: |
      Pass 1: closing the tab you are viewing lands you on the New Session tab; A's row is gone from the
      list. Pass 2: having switched to B before the close settles, the view STAYS on B — the close never
      yanks you back to New Session. In neither case is the selected tab left pointing at a session the
      board no longer lists.
---

# session-console — yatsu

Measure through the **real dashboard surface**, YATU-style: drive the actual browser interface (open with
`Enter`, click the tabs and the header **Close** button), never a direct `/api/sessions/:id/close` call or an
internal selection helper. The loss being scored is the tab-fallback contract in the spec: a closed session
leaves the board, and that **removal** — not the close button — is what decides where you land. You are still
on the closed tab → New Session; you already moved to another valid tab → your switch stands. Evidence is a
before/after screenshot pair of the tab list and active pane for each pass.
