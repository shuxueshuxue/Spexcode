---
scenarios:
  - name: advance-can-duplicate-never-skip
    tags: [cli]
    description: >-
      Exercise `advanceFollow` against a real store through `spex session wait`/`watch`. Offer positions
      lower and higher than the stored one, and confirm that sending a message to a session changes no
      cursor at all.
    expected: >-
      A lower offer is ignored and a higher offer advances the reader, so advancement is monotonic. A send
      changes no position anywhere: a transport has no opinion about what has been READ, and what a session
      owes its agent is a queue ([[delivery-queue]]), not a cursor. Stale reader state can only leave a
      position too LOW — an event read twice — never too high, which would lose one.
  - name: cursor-expires-by-being-read
    tags: [cli]
    description: >-
      Follow two live sessions, then delete one target's store dir — a close, not an unfollow. Read the
      follower's cursors, list what it follows, then make any unrelated write and inspect the file on disk.
      Separately, read a cursors file that is missing, empty, and syntactically broken.
    expected: >-
      The dead target's entry is gone from the read, and listing follows no longer names it: the follow
      ended because the target did, with nothing unregistered and no timer involved. The next write
      persists that reckoning, so the file stops naming it. A missing, empty, or unparseable file reads as
      "nothing consumed" rather than throwing — the honest recovery for a lost position is to re-show a
      message, never to skip one.
  - name: whole-line-readable-position
    tags: [cli]
    description: >-
      Write cursors through the TypeScript writer with several follows present, then read one target's
      position back by matching a whole line — no JSON parser, no value regex that could match a neighbour.
    expected: >-
      The file is one field per line, so a whole-line match finds a position exactly — the same shape and
      the same reason as the session record. Every write goes through the one writer that rewrites the file
      whole, so no reader's entry can be clobbered by a partial write of someone else's.
  - name: reader-sees-edges-not-lines
    tags: [cli]
    description: >-
      Take a log holding the shape the retired timeline observer left in real stores — one authored move
      written several times in a burst — and ask for the unread slice from before it, and again from a
      cursor placed INSIDE the run of duplicates. Also ask for a slice containing messages.
    expected: >-
      Each repeated status collapses to one transition: X to X is not a move. A cursor landing inside a
      duplicate run yields nothing, because the comparison is against the last status the reader already
      consumed rather than only the slice being read — otherwise a duplicate straddling the boundary would
      read as a fresh move on the very next tick. Messages are never collapsed. The returned next position
      is the full length: a dropped duplicate is still consumed, so the same bytes are never re-examined.
---

# session-cursors — yatsu

Every scenario here has a product surface: `spex session wait` / `watch` are what land on cursors
([[session-follow]]), so measure through that CLI and never through an import.

The loss being scored is asymmetric and worth naming: a position that ends up too low costs an event read
twice, while one too high costs an event nobody ever sees. Every scenario is a check that the second
failure has no path, including against history that already contains duplicates nobody can remove. What is
deliberately NOT scored here is whether a message reached an agent — that is a debt, measured on
[[delivery-queue]]. Spending one counter on both is what previously made a session's own declarations get
consumed as though they were mail.
