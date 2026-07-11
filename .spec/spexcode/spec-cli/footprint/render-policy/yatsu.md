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
  - name: vote-less-residence
    description: >
      On a host repo that already tracks its own CLAUDE.md/AGENTS.md/.gitignore (internal blank-line run
      included), adopt SpexCode through the real CLI (`spex init`) and read git's own verdicts: status,
      the .gitignore bytes, .git/info/exclude, the index blob of CLAUDE.md, the filter config/attributes.
      Then materialize a second time.
    expected: >
      No vote, no hint, no mystery-M: status is clean immediately (tracked contracts covered by the
      clean/smudge filter, index pristine, working tree carries the block), the host .gitignore is
      byte-untouched, the managed ignore block lives ONLY in per-clone .git/info/exclude (machine facts +
      run residue + wholly-ours renders; never a tracked contract file's name), and the second render is
      byte-stable (idempotence).
    tags: [backend-api, cli]
    code: spec-cli/src/materialize.ts
    related: [spec-cli/src/materialize.test.ts]
  - name: retired-axis-compat
    description: >
      On an adopted host, set every legacy footprint field a real deployment might still carry —
      render:"committed", render:"hidden", an unknown word, private:true — and run `spex materialize`
      through the real CLI, capturing stderr and the resulting residence state each time. Also plant a
      legacy managed block in the TRACKED .gitignore (the old ignored-mode home) and re-render.
    expected: >
      Every value is IGNORED with a loud, non-fatal stderr notice naming the removal recipe and `spex
      guide footprint` — never a failure, and the residence state is byte-identical to the no-field render
      (one behavior). The legacy .gitignore block is erased by the next render (forgetting law), leaving
      an honest one-time `M .gitignore` migration diff and the host's own rules intact.
    tags: [backend-api, cli]
    code: spec-cli/src/materialize.ts
  - name: user-prose-kind-transition
    description: >
      The common adoption path: init on a repo with NO contract file (CLAUDE.md is generated, wholly ours,
      excluded), then the user (or their agent) writes their own prose into CLAUDE.md. Re-render, read
      check-ignore/status/attributes, then run the user's own `git add CLAUDE.md` and read the index.
    expected: >
      Wholly-ours: excluded, invisible in status. The moment user prose enters, the next render WITHDRAWS
      the exclude entry (user content is never hidden) and pre-arms the clean filter; the file surfaces as
      honestly untracked (??). Their add succeeds — the staged blob carries their prose and NO sentinel
      block; the working tree keeps prose + block. SpexCode never staged or committed anything itself.
    tags: [backend-api, cli]
    code: spec-cli/src/materialize.ts
    related: [spec-cli/src/contract-filter.ts]
  - name: real-project-field-adoption
    description: >
      YATU on a REAL open-source project (a fresh clone carrying its own team CLAUDE.md), three parties
      simulated as a bare team.git remote plus adopter and teammate clones. Walk the full adoption loop
      through user surfaces only (spex verbs + bare git): A adopt (init, commit spec data, push, teammate
      pulls); B a real prose edit pushed through the filtered tracked CLAUDE.md; C a leak attempt — force-
      stage an artifact and a block-carrying blob, then commit with the planted hooks; D `spex uninstall`.
    expected: >
      A: spec data reaches the teammate, renders don't (no ignore-block in any tracked file, no render in
      the push), adopter AND teammate status clean, no decision hint anywhere. B: the teammate receives
      the prose edit without ever seeing the block; HEAD stays pristine. C: the pre-commit surgery strips
      the block from the staged blob and evicts the artifact — the commit lands clean with a printed note,
      no rejection. D: uninstall leaves zero residue — host CLAUDE.md byte-identical to its own prose, the
      whole teammate-visible adoption diff reduced to the spec data plus the team's own edits.
    tags: [backend-api, cli]
    code: spec-cli/src/worktree-sources.ts
    related: [spec-cli/src/materialize.ts, spec-cli/src/contract-filter.ts, spec-cli/src/commit-surgery.ts]
---

Measure through the real product surface, not by reading the code: a throwaway git repo shaped like the
host in question, the real `spex init`/`spex materialize`/`git worktree add`, and git's own reports
(`status --porcelain`, `show :file`, the exclude/attributes files) as the reading. The unit suite in
`spec-cli/src/materialize.test.ts` runs these same loops; a product-level reading replays them via the CLI
and files the transcript.
