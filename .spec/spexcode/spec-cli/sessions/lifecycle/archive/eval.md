---
scenarios:
  - name: shelve-and-restore-round-trip
    description: >
      Drive the real dashboard console in a browser against a live backend. Starting from the working
      session list, shelve the SELECTED session through the product's own Command Box (`/archive`), then
      read the rendered DOM at each step: the star door appears in the list header carrying the shelf
      count, the row leaves the working list, the shelf view holds it, and selecting it shows the shelf
      card. Restore with the card's one button. Read the record over `GET /api/sessions` to confirm what
      shelving did and did not change.
    expected: >
      The round trip returns the board to exactly its starting state. Shelving flips only `archived` —
      `lifecycle` is untouched, no process is stopped, no worktree removed. The star door is absent while
      nothing is shelved and appears with the count once something is, the shelved row is in exactly one of
      the two lists at a time, the shelf card is the ONLY thing visible and clickable for a shelved session
      (no live terminal layer over it), and restoring from the card returns both the row and the view to the
      working list — never stranding the human on the shelf they just emptied.
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
