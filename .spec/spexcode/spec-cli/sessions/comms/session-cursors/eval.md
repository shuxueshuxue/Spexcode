---
scenarios:
  - name: advance-can-duplicate-never-skip
    tags: [cli]
    description: >-
      Exercise the two writers a cursor actually has, against a real store: the reader's own
      `advanceInbox` and the sender's post-poke `consumeInboxAt`. Offer a position lower than the stored
      one; consume the line the cursor is sitting on; then consume a LATER line while an earlier one is
      still unread (the shape a lost poke leaves behind — message N's kick vanished, message N+1's landed).
      Read the file back after each.
    expected: >-
      A lower offer is ignored, so advancing is monotonic. Consuming the line the cursor sits on moves it
      by exactly one. Consuming a later line while an earlier one is unread does NOTHING: the sender may
      not jump the cursor over a message the agent was never shown, so the turn-boundary reader delivers
      both and the cost of a lost poke is a duplicate, never a loss. Every interleaving of the two writers
      can therefore only leave a position too LOW; no path produces one too high.
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
  - name: shell-readable-inbox
    tags: [cli]
    description: >-
      Write a cursor through the TypeScript writer, then read the inbox position back the way the
      mark-active hook actually does it: bash builtins only, matching a whole line, with no jq and no
      subprocess. Do it with a follows map present, so the inbox line is not the only line in the file.
    expected: >-
      The file is one field per line, so a whole-line match finds the inbox position exactly — the same
      shape and the same reason as the session record. The hook can therefore read its own position on
      every turn boundary without spawning anything, while never rewriting the file, so a follower's
      entries in that same file cannot be clobbered by a partial shell write.
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

Only `shell-readable-inbox` has a product surface on this branch: the `spex internal session-cursor` verb
and the hook that reads the file. The follow half — expiry-by-read, the full advance matrix, and the edge
slice — becomes measurable when `spex session wait` / `watch` land on cursors, and those three are
deliberately left as declared blind spots until then rather than measured through an import.

Measure the module the way its two real callers do — the sender advancing past a landed poke, and the
pure-shell hook reading its own position — never by reasoning about the file format. The loss being scored
is asymmetric and worth naming: a cursor that ends up too low costs a message shown twice, while a cursor
that ends up too high costs a message that is never delivered at all. Every scenario here is a check that
the second failure has no path, including under interleaved writers and against history that already
contains duplicates nobody can remove.
