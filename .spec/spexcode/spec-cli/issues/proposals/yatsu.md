---
scenarios:
  - name: write-robustness
    tags: [cli]
    code: spec-cli/src/proposals.ts
    description: >-
      Hammer the write path: (a) fire many `spex propose` concurrently and many `propose reply` at the SAME
      thread concurrently; (b) post a body whose line is exactly the reply sentinel `<!-- reply: x @ y -->`
      (a forgery attempt) with real body text after it.
    expected: >-
      (a) EVERY concurrent write lands and is git-committed (none left uncommitted, none lost to a
      read-modify-write race) — the store lock serializes the whole read-mutate-write-commit and the
      `--no-verify` commit keeps each fast. (b) The forged sentinel does NOT become a phantom reply and does
      NOT truncate the body (user content is neutralized on write); a genuine `reply` still parses. `spex lint`
      stays 0-error throughout.
  - name: forum-round-trip
    tags: [cli]
    code: spec-cli/src/proposals.ts
    related: [spec-cli/src/issues.ts]
    description: >-
      Through the real CLI, open a local issue (`spex propose "<concern>" --node <id> --evidence <hash>
      --body <text>`), then read it (`spex issues` — the one read over every store), then have another
      session sign it, reply to it, and resolve it (`spex propose sign|reply|resolve <id>`). Read back with
      `spex issues --all --store local --json`.
    expected: >-
      propose prints the minted id and commits the thread; `spex issues` lists the open concern store-tagged
      `local` with its author + linked node; sign/reply/resolve each report success; the final `--json` shows
      the concern with store=local, by=author, status=accepted, the evidence hash, the signer, and the reply
      (by/at/body) — every write round-trips faithfully through the unified read.
  - name: data-not-contract
    tags: [cli]
    code: spec-cli/src/proposals.ts
    related: [spec-cli/src/specs.ts, spec-cli/src/git.ts]
    description: >-
      After threads exist under `.spec/.issues/`, run `spex lint` and inspect the board/spec set. The
      store file is a plain `<id>.md`, not `spec.md`.
    expected: >-
      `spex lint` stays 0-error; no `.spec/.issues/` entry appears as a spec node (the walk never nodes it) and no
      ghost node appears on the board overlay (`isSpecMd` ignores a non-`spec.md` path) — the store is
      structurally invisible to lint/drift/deriveStatus with NO special-case exemption.
  - name: forum-only-commit-on-trunk
    tags: [cli]
    code: spec-cli/src/proposals.ts
    related: [spec-cli/templates/hooks/pre-commit]
    description: >-
      On the trunk, let `spex propose` commit a store file directly (the writer uses `git commit
      --no-verify`). Then try a plain `git commit` (hook active) on the trunk that touches a non-store path,
      and one that touches ONLY a store file.
    expected: >-
      The programmatic store write lands on the trunk because it commits `--no-verify` — it bypasses the hook
      entirely, needing no guard exception. A plain non-store commit is still BLOCKED, and a plain
      store-only commit (no `--no-verify`) is now blocked TOO: main-guard carries no `.spec/.issues/`
      special-case, so the guard stays the single clean question "am I committing directly onto the trunk?".
  - name: post-merge-nudge
    tags: [cli]
    code: spec-cli/templates/hooks/post-merge
    description: >-
      With the hooks installed, merge a `node/<id>` branch into the trunk with `--no-ff` (subject
      `merge node/<id>: …`), then perform an unrelated `--no-ff` merge with a non-node subject.
    expected: >-
      The node merge prints the proposals nudge in the merge command's own output, naming the merged
      node id; the unrelated merge stays silent (the hook is guarded to `merge node/*`).
  - name: feature-toggle
    tags: [cli]
    code: spec-cli/src/proposals.ts
    related: [spec-cli/templates/hooks/post-merge, spec-cli/src/layout.ts]
    description: >-
      Read `spex propose status` with no config (default). Then `spex propose off`, inspect spexcode.json,
      merge a node branch. Then `spex propose on` and merge another node branch.
    expected: >-
      Default status is ON with no config needed. `off` writes `proposals.enabled: false` to spexcode.json and
      `status` reports OFF; the next node merge prints NO nudge (and `spex propose nudge <node>` is empty). `on`
      restores the nudge on the following merge — the git hook honors the switch through the CLI, with
      spexcode.json the single source of truth.
---

# measuring proposals

YATU through the real `spex` CLI and real `git`, never an internal helper. The store's whole value is that
an agent's taste survives session end, so the measurement drives the same surface an agent touches: `spex
propose`/`proposals` for the round-trip, `spex lint` + the board for the data-not-contract invariant, a real
`git commit` on the trunk for the main-guard exception, and a real `git merge --no-ff` for the post-merge
nudge. Backend evidence is the command transcript (`--result`), captured in a throwaway repo so a
measurement never writes to the live trunk.
