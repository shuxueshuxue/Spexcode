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
---

Measure the user-visible test command and the real default store count. The temporary repository is an
ordinary existing test fixture, so the count demonstrates the same project-store path a new test would use.
