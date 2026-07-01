---
scenarios:
  - name: forum-round-trip
    tags: [cli]
    code: spec-cli/src/proposals.ts
    description: >-
      Through the real CLI, open a proposal (`spex propose "<concern>" --node <id> --body <text>`), then
      read it (`spex proposals`), then have another session sign it, reply to it, and resolve it
      (`spex propose sign|reply|resolve <id>`). Read back with `spex proposals --all --json`.
    expected: >-
      propose prints the minted id and commits the thread; `spex proposals` lists the open concern with its
      author + linked node; sign/reply/resolve each report success; the final `--json` shows the concern with
      by=author, status=accepted, the signer, and the reply (by/at/body) — every write round-trips faithfully.
  - name: data-not-contract
    tags: [cli]
    code: spec-cli/src/proposals.ts
    related: [spec-cli/src/specs.ts, spec-cli/src/git.ts]
    description: >-
      After proposals exist under `.spec/.proposal/`, run `spex lint` and inspect the board/spec set. The
      forum file is a plain `<id>.md`, not `spec.md`.
    expected: >-
      `spex lint` stays 0-error; no `.proposal` entry appears as a spec node (the walk never nodes it) and no
      ghost node appears on the board overlay (`isSpecMd` ignores a non-`spec.md` path) — the forum is
      structurally invisible to lint/drift/deriveStatus with NO special-case exemption.
  - name: forum-only-commit-on-trunk
    tags: [cli]
    code: spec-cli/src/proposals.ts
    related: [spec-cli/templates/hooks/pre-commit]
    description: >-
      On the trunk, let `spex propose` commit a forum file directly. Then try a plain `git commit` on the
      trunk that touches a non-forum path, and one that touches BOTH a forum file and a non-forum path.
    expected: >-
      The forum-only commit is admitted on the trunk (main-guard's forum-data exception). A non-forum commit
      is still BLOCKED, and a MIXED (forum + non-forum) commit is blocked too — the exception can't smuggle
      real work onto the trunk.
  - name: post-merge-nudge
    tags: [cli]
    code: spec-cli/templates/hooks/post-merge
    description: >-
      With the hooks installed, merge a `node/<id>` branch into the trunk with `--no-ff` (subject
      `merge node/<id>: …`), then perform an unrelated `--no-ff` merge with a non-node subject.
    expected: >-
      The node merge prints the proposal-forum nudge in the merge command's own output, naming the merged
      node id; the unrelated merge stays silent (the hook is guarded to `merge node/*`).
---

# measuring proposals

YATU through the real `spex` CLI and real `git`, never an internal helper. The forum's whole value is that
an agent's taste survives session end, so the measurement drives the same surface an agent touches: `spex
propose`/`proposals` for the round-trip, `spex lint` + the board for the data-not-contract invariant, a real
`git commit` on the trunk for the main-guard exception, and a real `git merge --no-ff` for the post-merge
nudge. Backend evidence is the command transcript (`--result`), captured in a throwaway repo so a
measurement never writes to the live trunk.
