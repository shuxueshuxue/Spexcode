---
scenarios:
  - name: session-worktree-delivery
    description: >
      On a repo whose spec data is tracked (the model's invariant), create a session worktree the way
      newSession does (git worktree add + seed + materialize) and measure what a dispatched agent finds:
      does the worktree carry the spec sources (.spec, spexcode.json via checkout; spexcode.local.json via
      copy), does `spex board`/lint from inside it see the project's nodes, and are the sources real files
      (never symlinks)?
    expected: >
      The fresh worktree holds all three spec sources as REAL files — .spec and spexcode.json delivered by
      git checkout, spexcode.local.json as a copied snapshot — spex inside it sees the full node tree, and
      nothing in the repo's tracked files changes. No symlink anywhere: a link is a write-semantics
      declaration this model retired.
    tags: [backend-api, cli]
    code: spec-cli/src/worktree-sources.ts
    related: [spec-cli/src/sessions.ts, spec-cli/hooks/dispatch.sh]
  - name: worktree-host-state-isolation
    description: >
      Seed a session worktree the way newSession does, then run the two probes that produced real
      incidents: (1) a worker overwrites "its" spexcode.local.json in the worktree — read the MAIN
      checkout's spexcode.local.json afterwards; (2) run `git status --porcelain` from inside the worktree —
      list what an agent's `git add -A` would pick up.
    expected: >
      (1) The main checkout's spexcode.local.json is byte-identical to before the worker's write — the
      worktree got a per-worktree COPY snapshot, not a shared write path (launchers config survives).
      (2) git status inside the worktree shows no seeded entry — seeding hides what it makes git-visible in
      the shared .git/info/exclude, so nothing tempts a force-add.
    tags: [backend-api, cli]
    code: spec-cli/src/worktree-sources.ts
    related: [spec-cli/src/sessions.ts]
  - name: policy-round-trip
    description: >
      On a host repo that already tracks its own CLAUDE.md/AGENTS.md/.gitignore (with an internal
      blank-line run), adopt SpexCode and walk the render policies through the real CLI:
      ignored → hidden → committed → ignored, then render the final policy twice. At each stop inspect
      git status, the .gitignore bytes, .git/info/exclude, and the contract files.
    expected: >
      Each policy renders its own contract exactly (ignored: block in tracked .gitignore; hidden: clean
      status, block in exclude, index pristine via the content filter; committed: render entries leave the
      block, machine facts stay). The final return to ignored converges BYTE-FOR-BYTE with the first
      ignored render (the forgetting law), and the doubled render changes nothing (idempotence). The user's
      blank-line run survives every hop.
    tags: [backend-api, cli]
    code: spec-cli/src/materialize.ts
    related: [spec-cli/src/materialize.test.ts]
  - name: legacy-private-compat
    description: >
      On a legacy untrack-private-shaped repo (spexcode.local.json {"private":true}, .spec + spexcode.json
      present but untracked), run `spex materialize` through the real CLI and capture stderr and the
      resulting ignore homes.
    expected: >
      The render behaves as render=hidden (managed block in .git/info/exclude, none in a tracked
      .gitignore) and stderr carries the loud, non-fatal migration notice: the private→render:"hidden"
      mapping, the one-time `git add .spec spexcode.json` recipe, and the pushed-history-is-not-recallable
      WARN. The run itself succeeds — the deployment keeps working until migrated.
    tags: [backend-api, cli]
    code: spec-cli/src/materialize.ts
  - name: real-project-field-adoption
    description: >
      YATU on a REAL open-source project (a fresh honojs/hono clone carrying its own team CLAUDE.md), three
      parties simulated as a bare team.git remote plus adopter and teammate clones. Walk the full adoption
      loop through user surfaces only (spex verbs + bare git, config learned from `spex guide footprint`):
      A adopt with the default ignored (init, commit spec data, push, teammate pulls); B switch to hidden
      (exclude home, content filter on the tracked CLAUDE.md, a real prose edit pushed through the filtered
      file); C switch to committed (renders enter the repo, teammate discovers natively); D the forgetting
      law committed→hidden→ignored→initial and a final spex uninstall; E legacy {"private":true} through
      materialize.
    expected: >
      A: spec data + .gitignore block reach the teammate, renders don't, teammate status clean, the tracked
      host CLAUDE.md honestly dirty on the adopter. B: block migrates to .git/info/exclude, adopter status
      clean via the guarded renormalize, HEAD pristine, and the teammate receives the prose edit without
      ever seeing the block. C: the block reaches the teammate's CLAUDE.md/AGENTS.md natively. D: every
      switch converges to that policy's exact state (the return to ignored equals the step-A state) and
      uninstall leaves zero residue — no empty .claude/.codex, host CLAUDE.md byte-identical to its own
      prose, the whole teammate-side adoption diff reduced to the spec data plus the team's own edit.
      E: private:true maps to hidden with a loud, non-fatal stderr migration notice. All five, with no
      contract deviation.
    tags: [backend-api, cli]
    code: spec-cli/src/worktree-sources.ts
    related: [spec-cli/src/materialize.ts, spec-cli/src/contract-filter.ts]
---

Measure through the real product surface, not by reading the code: a throwaway git repo shaped like the
host in question, the real `spex init`/`spex materialize`/`git worktree add`, and git's own reports
(`status --porcelain`, `show :file`, the exclude/attributes files) as the reading. The unit suite in
`spec-cli/src/materialize.test.ts` runs these same loops; a product-level reading replays them via the CLI
and files the transcript.
