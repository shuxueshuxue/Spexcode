---
scenarios:
  - name: shelve-and-restore-round-trip
    description: >
      Drive the real dashboard console in a browser against a live backend. Starting from the session
      list, archive the SELECTED session through the product's own Command Box (`/archive`), then read the
      rendered DOM at each step: the header's three pills, the star door's count, the row leaving the list,
      the archive view holding it, and the archive card on selecting it. Restore with the card's one
      button. Read the record over `GET /api/sessions` to confirm what archiving did and did not change.
    expected: >
      The round trip returns the board to exactly its starting state. Archiving flips only `archived` —
      `lifecycle` is untouched, no process is stopped, no worktree removed. The header always shows three
      equal pills including the star, whose count appears only when something is archived and which is inert
      at zero; the archived row is in exactly one of the two lists at a time; the archive card is the ONLY
      thing visible and clickable for an archived session (no live terminal layer over it); the row's
      right-click menu offers exactly one direction and acts with no confirm; and the view never strands in an
      emptied archive — not when restoring from the card, and not when the archive is emptied from outside the
      browser while it is open.
    tags: [frontend-e2e]
  - name: shelving-costs-no-git-walk
    description: >
      Call `GET /api/graph` and read the shelved session's worktree row. The board enumerates every record,
      shelved or not, so the row must be present; the per-worktree spec-delta (`ops`) is the expensive
      git-history probe archive exists to stop paying.
    expected: >
      A shelved session still has a board row (enumeration is existence truth, never a view preference), and
      that row's `ops` is empty — the delta is skipped rather than computed and hidden.
    tags: [backend-api]
---

# eval — archive

YATU: measured through the surfaces a human actually touches — a real Chromium driving the real dashboard
over a real backend for the console journey, and the real HTTP endpoint for the board-cost claim. No internal
helper is called to make either proof easy: the shelving act itself goes through the Command Box exactly as a
human would type it, and every assertion reads rendered DOM or a served payload.

The round trip is a **multi-step interaction flow**, so its evidence is a recording of the run with a
step-map exported by the runner, not a still — a single frame could show the shelf card while saying nothing
about whether the row actually left, came back, or whether the button was reachable at all. That last one is
not hypothetical: the first run of this scenario failed because a live xterm layer sat over the card and
swallowed the restore click while the card looked perfectly correct in a screenshot.
