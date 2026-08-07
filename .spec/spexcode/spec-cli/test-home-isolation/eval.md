---
scenarios:
  - name: temporary-root-never-grows-user-home
    description: >
      With inherited service, project, session, port, and SPEXCODE_HOME variables removed, count the real
      user's ~/.spexcode/projects/-tmp-* directories, run the existing temporary-root commit-gate test
      through its package test command, then count again. Also run that command with SPEXCODE_HOME set to
      the real user home.
    expected: >
      The existing commit-gate test passes while the real-home directory count has delta zero. The package
      test command rejects SPEXCODE_HOME equal to the real user home with a non-zero exit and a clear error;
      it never silently redirects that unsafe invocation.
    tags: [cli]
    test:
      path: spec-cli/src/test-home.test.ts
      name: test bootstrap rejects the real home and removes its disposable home on exit
    code: scripts/test-home.mjs
    related: [spec-cli/package.json, spec-eval/package.json, spec-cli/src/commit-gate.test.ts]
  - name: no-test-process-writes-anywhere-under-the-user-store
    description: >
      Point HOME at a fresh empty directory so the location the product resolves as the user's persistent
      store is one nobody else writes to, strip the inherited service, project, session, port, and
      SPEXCODE_HOME variables, and run each package's own test command there. Record the store path the
      product's own resolver reports from INSIDE a process the bootstrap has prepared, and check that path
      again after the process exits. Then read the criterion as: does anything at all exist under that
      decoy's .spexcode, at any depth and under any name. Then prove the criterion can fire, in the same
      run: with nothing isolating it, write one session artifact through the product's own store resolver
      and read the decoy again. Finally count that same write the way the sibling scenario counts,
      projects/-tmp-*.
    expected: >
      Both package test commands run to completion, and the two halves account for DIFFERENT writers,
      because the bootstrap redirects the resolver rather than leaving it pointed at the decoy: the resolver
      reports a disposable home under the OS temp directory, and that directory is gone once the process
      exits. That conjunct is what covers every writer that reaches the store through the resolver, which is
      nearly all of them, and it is stated as its own reading because their absence from the decoy is
      guaranteed by the redirect rather than measured by it. The decoy's .spexcode is then absent, and what
      that absence measures is the remaining class: code that joins the user's home with the store name
      itself, ignores the redirect, and lands in whatever HOME it is given. The criterion is store-scoped,
      not HOME-scoped: launched harness child processes do write their own configuration directly into the
      decoy HOME, and those entries are evidence rather than noise, because they show real child processes
      resolved the decoy instead of the run being a no-op. The positive control fills the decoy at
      .spexcode/projects/<project>/sessions/<id>/, so a silent reading is a measurement and not an absent
      population; it runs with nothing isolating it on purpose, which is the apt control here because a
      writer that bypasses the resolver resolves exactly the way an unisolated resolver does. That same
      write leaves the projects/-tmp-* count at zero, which is why this criterion names no path: it is
      satisfiable only by nothing having been written, while an enumeration of named paths goes blind as
      soon as a writer picks a path outside it. One residue this reading cannot retire, and states rather
      than hides: a bypass writer whose write is gated on its own artifact being absent stays silent on any
      machine that already has that artifact, so an absent decoy here is never a claim about a fresh
      machine.
    tags: [cli]
    code: scripts/test-home.mjs
    related: [spec-cli/package.json, spec-eval/package.json, spec-cli/src/layout.ts]
---

Measure the user-visible test command and the real default store count. The temporary repository is an
ordinary existing test fixture, so the count demonstrates the same project-store path a new test would use.

The second scenario exists because the first one's axis is a glob at one level of `projects/`, while session
records live one level deeper inside a project directory whose name never matches `-tmp-*`. A decoy HOME
moves the whole resolved store instead of watching part of it, so the reading cannot be blind by
construction. Its positive control is not ceremony: an empty decoy and an unreachable writer produce the
same silence, so the run has to show the detector firing before its silence counts as evidence.

The criterion is deliberately store-scoped rather than HOME-scoped, because a HOME-scoped one was measured
false: the suite launches real harness child processes, and they write their own configuration into whatever
HOME they are given. Demanding an untouched HOME would fail on behaviour that is not this node's concern,
while those same writes are the cheapest available confirmation that the decoy really was the HOME the child
processes resolved.

The decoy and the redirect are not two views of one population, and reading them as one is how this axis
would go quietly blind. The store resolver consults `SPEXCODE_HOME` BEFORE it consults the user's home, and
the bootstrap always sets it, so from inside the suite the decoy is unreachable THROUGH the resolver — if the
resolver were the only road to the store, an empty decoy would be guaranteed rather than measured, and the
reading would be reporting the redirect's existence under the name of a search. What keeps the axis real is
that the resolver is not the only road: code that joins the user's home with the store name itself never asks
`SPEXCODE_HOME` anything, so it follows HOME into the decoy, and it escapes the sibling scenario's
`projects/-tmp-*` glob whenever it writes BESIDE `projects/` instead of inside it. That class is the decoy's
actual population. So the reading states the redirect's target and its removal as a conjunct of its own: the
redirect accounts for the writers that ask the resolver, and the decoy accounts for the ones that never do.

That split also fixes where this axis is weakest, which is worth naming because the weakness is invisible from
one machine. A bypass writer that generates a durable artifact once and then short-circuits on finding it
writes nothing on any machine where the artifact already exists — so the decoy reads absent, repeatably and
greenly, on exactly the developer machines most likely to run this scenario, and the escape appears only on a
machine that has never had it. Re-running proves nothing here; only a fresh home does. The criterion therefore
records what it did not rule out instead of letting a green reading imply it.
