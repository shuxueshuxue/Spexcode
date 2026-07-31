---
scenarios:
  - name: git-children-use-one-resolved-executable-per-path
    tags: [cli]
    description: >-
      Run the Git adapter's real graph-build test with a PATH-prepended executable wrapper, exercising both
      asynchronous and synchronous children inside and outside the bounded build context.
    expected: >-
      Every child uses the executable selected from the child environment's PATH; the bounded context adds
      only its pack flags and does not leak them to later calls. A changed PATH selects the current executable
      rather than a stale process-global result.
    test: spec-cli/src/git.test.ts
---
# eval.md — git-exec

The executable seam is measured through the real Git adapter suite: the wrapper records which binary each
child runs and the test compares the bounded and ordinary child commands.
