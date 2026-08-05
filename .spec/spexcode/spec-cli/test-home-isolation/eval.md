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
      SPEXCODE_HOME variables, and run each package's own test command there. Read the criterion as: does
      anything at all exist under that decoy's .spexcode, at any depth and under any name. Then prove the
      criterion can fire, in the same run: with nothing isolating it, write one session artifact through the
      product's own store resolver and read the decoy again. Finally count that same write the way the
      sibling scenario counts, projects/-tmp-*.
    expected: >
      Both package test commands run to completion and the decoy's .spexcode is absent. The criterion is
      store-scoped, not HOME-scoped: launched harness child processes do write their own configuration
      directly into the decoy HOME, and those entries are evidence rather than noise, because they show real
      child processes resolved the decoy instead of the run being a no-op. The positive control fills the
      decoy at .spexcode/projects/<project>/sessions/<id>/, so a silent reading is a measurement and not an
      absent population. That same write leaves the projects/-tmp-* count at zero, which is why this
      criterion names no path: it is satisfiable only by nothing having been written, while an enumeration of
      named paths goes blind as soon as a writer picks a path outside it.
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
