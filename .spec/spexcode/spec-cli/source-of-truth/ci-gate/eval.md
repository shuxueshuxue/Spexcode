---
scenarios:
  - name: clean-ci-install-build-lint-order
    tags: [cli]
    code: .github/workflows/ci.yml
    related:
      - package.json
      - spec-cli/package.json
      - spec-dashboard/package.json
    description: >-
      In a fresh checkout, execute the installation and preparation sequence used by the CI workflow:
      install the spec-cli and dashboard package-local dependency plans, run the root canonical workspace
      install, build the internal workspace packages, then run npm run lint. Capture every command's exit
      status and terminal output through the real package manager and CLI surfaces.
    expected: >-
      All installs, the workspace build, and lint exit 0. The package-local lockfiles remain valid, and
      the root workspace links resolve each internal package to an emitted dist entry before the lint
      command loads the CLI. CI must not report a missing internal dist module or a dependency-resolution
      failure caused by one installation step replacing another.
  - name: spec-cli-typecheck-is-clean
    tags: [cli]
    code: .github/workflows/ci.yml
    related:
      - spec-cli/tsconfig.json
      - spec-cli/src/anchors.test.ts
      - spec-cli/src/reviews.test.ts
    description: >-
      In a clean checkout after the workflow installation sequence and workspace build, run
      npx tsc --noEmit from spec-cli. Capture the compiler transcript and exit status.
    expected: >-
      TypeScript exits 0 with no diagnostics. Dynamic module-test helpers describe only the exports they
      consume, and every @ts-expect-error still suppresses a real error rather than becoming stale debt.
  - name: spec-cli-unit-integration-suite-is-clean
    tags: [cli]
    code: .github/workflows/ci.yml
    related:
      - spec-cli/package.json
      - spec-cli/src/runtime-rotate.cli.test.ts
      - spec-cli/src/sessions.test.ts
      - spec-cli/src/workspace-precondition.cli.test.ts
    description: >-
      After the workflow installation and build sequence, run the complete spec-cli npm test suite under
      the same Node test runner configuration used by CI. Capture the command transcript and exit status.
    expected: >-
      The suite exits 0. Its isolated fixtures resolve project launcher configuration from their own
      repository, do not remove a temporary runtime while a mocked launch is still writing into it, and
      compare canonical workspace paths on platforms where a temporary-directory alias is resolved.
---

Measured through the same clean-checkout package-manager commands that the GitHub Actions workflow runs.
The loss is a workflow that looks installed but reaches lint before its internal workspace artifacts are
available, or whose package-local lockfile installation is invalidated by the root install order.
