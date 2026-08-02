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
  - name: sync-git-keeps-large-repository-output-whole
    tags: [cli]
    description: >-
      Build a real Git tree whose NUL-framed name stream exceeds Node's default synchronous child-process
      buffer, then read that tree through the public synchronous Git adapter.
    expected: >-
      The adapter returns the complete byte stream under one explicit shared synchronous budget. A legitimate
      repository answer is never truncated or rejected at Node's default limit, and an output overflow is not
      reported as a timeout merely because both boundaries terminate the child with SIGKILL.
    test: spec-cli/src/git.test.ts
---
# eval.md — git-exec

The executable seam is measured through the real Git adapter suite: the wrapper records which binary each
child runs and the test compares the bounded and ordinary child commands. A real large tree separately makes
the synchronous adapter carry a name stream beyond Node's default buffer without substituting a fake child.
