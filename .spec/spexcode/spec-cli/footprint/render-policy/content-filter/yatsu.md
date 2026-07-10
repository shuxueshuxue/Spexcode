---
scenarios:
  - name: hidden-tracked-contract
    description: >
      On a host repo that TRACKS its own CLAUDE.md/AGENTS.md, set render=hidden and materialize through the
      real CLI. Read git's own verdicts: `git status --porcelain`, the worktree file, `git show :CLAUDE.md`
      (the index), `git config filter.spexcode.*`, and .git/info/attributes. Include a host file that
      BEGINS with blank lines.
    expected: >
      Status is completely clean (no leak, no phantom-M — the content-guarded renormalize settles the
      stat); the working tree carries the sentinel contract block while the index blob stays byte-pristine
      (leading blanks included: clean(smudge(x)) == x); the filter config + attribute lines exist only in
      per-clone homes. A genuine user edit to the prose still shows as an honest modification.
    tags: [backend-api, cli]
    code: spec-cli/src/contract-filter.ts
    related: [spec-cli/src/materialize.test.ts]
  - name: filter-edges
    description: >
      Exercise the three field-sharpened edges through the real CLI + git: (1) delete the planted shim and
      run git operations; (2) edit a surface:system node (commit the data) and re-materialize, then read
      the working file and the index; (3) `spex uninstall` and inspect status, the contract file bytes, the
      filter config/attributes, and .git/spexcode/.
    expected: >
      (1) git keeps working — the configured command degrades to identity, no per-operation fatal. (2) the
      new contract text reaches the working file (the re-render IS the re-smudge), status stays clean, the
      index never sees the block. (3) uninstall strips the block BEFORE the config goes: no uncommitted-
      modification residue, the host file returns to its exact pristine bytes, config unset, shim + block
      content removed, the user's .spec untouched.
    tags: [backend-api, cli]
    code: spec-cli/src/contract-filter.ts
    related: [spec-cli/src/uninstall.ts, spec-cli/src/materialize.ts]
---

Measured through git itself (YATU: git is the user of a filter): throwaway host repos, the real
`spex materialize`/`spex uninstall`, and git's own reports as the reading — never a hand-run of the shim
in isolation. The unit suite in `spec-cli/src/materialize.test.ts` pins the same edges; a product-level
reading replays them via the CLI and files the transcript.
