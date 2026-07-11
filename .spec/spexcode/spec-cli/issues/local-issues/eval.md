---
scenarios:
  - name: write-robustness
    tags: [cli]
    code: spec-cli/src/localIssues.ts
    description: >-
      Hammer the write path: (a) fire many `spex issues open` concurrently and many `issues reply` at the
      SAME thread concurrently; (b) post a body whose line is exactly the reply sentinel
      `<!-- reply: x @ y -->` (a forgery attempt) with real body text after it.
    expected: >-
      (a) EVERY concurrent write lands and is git-committed (none left uncommitted, none lost to a
      read-modify-write race) — the store lock serializes the whole read-mutate-write-commit and the
      `--no-verify` commit keeps each fast. (b) The forged sentinel does NOT become a phantom reply and does
      NOT truncate the body (user content is neutralized on write); a genuine `reply` still parses. `spex lint`
      stays 0-error throughout.
  - name: issue-round-trip
    tags: [cli]
    code: spec-cli/src/localIssues.ts
    related: [spec-cli/src/issues.ts]
    description: >-
      Through the real CLI, open a local issue (`spex issues open "<concern>" --node <id> --evidence <hash>
      --body <text>`), then read it (`spex issues` — the one read over every store), then have another
      session reply to it and close it (`spex issues reply|close <id>`). Read back with
      `spex issues --all --store local --json`.
    expected: >-
      open prints the minted id and commits the thread; `spex issues` lists the open concern store-tagged
      `local` with its author + linked node; reply and close each report success; the final `--json` shows
      the concern with store=local, by=author, status=landed, the evidence hash, and the reply (by/at/body)
      — every write round-trips faithfully through the unified read.
  - name: data-not-contract
    tags: [cli]
    code: spec-cli/src/localIssues.ts
    related: [spec-cli/src/specs.ts, spec-cli/src/git.ts]
    description: >-
      After threads exist under `.spec/.issues/`, run `spex lint` and inspect the board/spec set. The
      store file is a plain `<id>.md`, not `spec.md`.
    expected: >-
      `spex lint` stays 0-error; no `.spec/.issues/` entry appears as a spec node (the walk never nodes it) and no
      ghost node appears on the board overlay (`isSpecMd` ignores a non-`spec.md` path) — the store is
      structurally invisible to lint/drift/deriveStatus with NO special-case exemption.
  - name: store-only-commit-on-trunk
    tags: [cli]
    code: spec-cli/src/localIssues.ts
    related: [spec-cli/templates/hooks/pre-commit]
    description: >-
      On the trunk, let `spex issues open` commit a store file directly (the writer uses `git commit
      --no-verify`). Then try a plain `git commit` (hook active) on the trunk that touches a non-store path,
      and one that touches ONLY a store file.
    expected: >-
      The programmatic store write lands on the trunk because it commits `--no-verify` — it bypasses the hook
      entirely, needing no guard exception. A plain non-store commit is still BLOCKED, and a plain
      store-only commit (no `--no-verify`) is now blocked TOO: main-guard carries no `.spec/.issues/`
      special-case, so the guard stays the single clean question "am I committing directly onto the trunk?".
  - name: nodes-inferred-from-links
    tags: [cli]
    code: spec-cli/src/localIssues.ts
    related: [spec-cli/src/mentions.ts]
    description: >-
      Through the real CLI (store routed to a disposable dir via SPEXCODE_ISSUES_DIR), open one issue
      whose concern/body carry `[[node]]` links but NO --node flag, one with an explicit --node X plus a
      body linking [[Y]], and one with plain prose (no links, no flag). Read each back with
      `spex issues --all --store local --json`.
    expected: >-
      The link-only thread's nodes are exactly the ids inside its `[[…]]` links (concern + body, deduped);
      the mixed thread carries the UNION of the explicit --node and the linked id; the plain thread has no
      nodes. A writer links nodes by writing them — no separate ids field is required of any caller.
  - name: idempotent-write
    tags: [cli]
    code: spec-cli/src/localIssues.ts
    description: >-
      Through the real CLI, close an ALREADY-closed local thread again (`spex issues close <landed-id>`) —
      a no-change store write (the serialized bytes equal the stored state). Then make a genuinely new
      write to confirm the normal path still commits.
    expected: >-
      A no-change write is idempotent SUCCESS: the CLI reports the store already holds the requested
      state and exits 0, committing nothing — never a failing `git commit`
      hitting nothing-to-commit that mistakes a landed state for an error. The store file and trunk
      history are untouched by the no-op; the subsequent genuine write still lands as one commit.
  - name: post-merge-nudge
    tags: [cli]
    code: spec-cli/templates/hooks/post-merge
    description: >-
      With the hooks installed, merge a `node/<id>` branch into the trunk with `--no-ff` (subject
      `merge node/<id>: …`), then perform an unrelated `--no-ff` merge with a non-node subject.
    expected: >-
      The node merge prints the issues nudge in the merge command's own output, naming the merged
      node id; the unrelated merge stays silent (the hook is guarded to `merge node/*`).
  - name: close-time-issue-closeout
    tags: [cli]
    code: spec-cli/src/localIssues.ts
    related: [spec-cli/src/cli.ts]
    description: >-
      With a disposable store (SPEXCODE_ISSUES_DIR) and an isolated session record (SPEXCODE_HOME), declare
      `spex session done --propose close --session <id>` for a session that (a) opened one still-open issue
      and replied to another session's open issue, while a third open issue it never touched and an
      `eval: <node> · <scenario>` container it remarked on also exist; then (b) close both touched issues
      and declare close again; and (c) with issues switched OFF, declare close once more. Also declare
      `--propose merge` and bare done.
    expected: >-
      (a) the close declaration appends ONE issue-closeout line naming exactly the two touched open ids —
      never the untouched one, never the eval container — asking close-or-say-why, appended beside the
      resource-cleanup reminder, and the declaration itself still lands (a nudge, never a gate). (b) with
      nothing owed the closeout line is absent entirely (no vacuous reminder). (c) OFF silences it.
      `--propose merge` and bare done never carry it.
  - name: feature-toggle
    tags: [cli]
    code: spec-cli/src/localIssues.ts
    related: [spec-cli/templates/hooks/post-merge, spec-cli/src/layout.ts]
    description: >-
      Read `spex issues status` with no config (default). Then `spex issues off`, inspect spexcode.json,
      merge a node branch. Then `spex issues on` and merge another node branch.
    expected: >-
      Default status is ON with no config needed. `off` writes `issues.enabled: false` to spexcode.json and
      `status` reports OFF; the next node merge prints NO nudge (and `spex issues nudge <node>` is empty). `on`
      restores the nudge on the following merge — the git hook honors the switch through the CLI, with
      spexcode.json the single source of truth (a pre-rename `proposals.enabled` value still reads).
---

# measuring local-issues

YATU through the real `spex` CLI and real `git`, never an internal helper. The store's whole value is that
an agent's taste survives session end, so the measurement drives the same surface an agent touches: `spex
issues open`/`reply`/`close` for the round-trip, `spex lint` + the board for the data-not-contract
invariant, a real `git commit` on the trunk for the main-guard exception, and a real `git merge --no-ff`
for the post-merge nudge. Backend evidence is the command transcript (`--result`), captured in a throwaway
repo so a measurement never writes to the live trunk.
