---
scenarios:
  - name: advance-can-duplicate-never-skip
    tags: [cli]
    description: >-
      Exercise the turn-boundary reader's `advanceInbox` against a real store. Offer positions lower and
      higher than the stored one, then send while the adapter poke is accepted but cannot be confirmed and
      read the target cursor before its next turn boundary.
    expected: >-
      A lower offer is ignored and a higher offer advances the reader, so advancement is monotonic. A
      socket write alone never changes the target cursor: the line remains unread until the target's next
      turn-boundary reader prints it and advances. A lost or replayed poke therefore cannot skip a message;
      stale reader state can only leave a position too LOW, never too high.
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

Measure the module through its one real writer, the pure-shell hook advancing its own position, never by
reasoning about the file format. The loss being scored is asymmetric and worth naming: a cursor that ends
up too low costs a message shown twice, while a cursor that ends up too high costs a message that is never
delivered at all. Every scenario here is a check that the second failure has no path, including against
history that already contains duplicates nobody can remove.
