---
scenarios:
  - name: govern-capped-at-one
    tags: [cli]
    description: >-
      On a tree where a spec node lists more than one file under `code:`, run `spex lint`. The
      node-side cap must fire as an ERROR (not a warning) — the `one-govern` rule — naming the node
      and its files and telling the author to keep the one true subject and demote the rest to
      related. A node with exactly one (or zero) govern file must NOT trip it. Reproduce by adding a
      second `code:` entry to any single-govern node, linting, then reverting.
    expected: >-
      `spex lint` reports `one-govern` at ERROR level for the >1 node (`'<node>' governs N files
      [...] — a node is source of truth for at most ONE`) and the run counts a non-zero error, so
      the pre-commit gate blocks. On the ≤1-govern tree the count is `0 error(s)` — the rule is
      silent at zero and one.
  - name: related-drift-is-soft
    tags: [cli]
    description: >-
      On a tree where files listed under nodes' `related:` have commits ahead of their node's spec
      version, run `spex lint`. The related (soft) tier must surface as a SINGLE summary warning —
      the count of related files across N nodes — never a per-file wall, never an error, and it must
      never block the commit gate or feed yatsu/ack (driftGate and yatsu attribution stay
      govern-only).
    expected: >-
      `spex lint` emits exactly ONE `related-drift` line at WARN level, of the form `<K> related
      file(s) across <M> node(s) drifted ahead of their spec (SOFT … never blocks, no ack, no
      yatsu)`, not one line per file; it adds 0 errors and the run still exits clean (the gate is
      unaffected).
---
# eval.md — spec-lint

Measured through the real `spex lint` CLI (this worktree's `spec-cli/src/lint.ts`, run with tsx), on
this repo's own `.spec` tree. Two tiers of the [[governed-related]] link are pinned: the node-side
**govern cap** is a hard error that forces one source of truth; the **related** tier is a soft,
summarised warn that nudges but never blocks. YATU: the real CLI on the real tree, not a unit probe.
