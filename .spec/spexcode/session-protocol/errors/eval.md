---
scenarios:
  - name: installed-package-errors-stay-closed-and-loud
    tags: [backend-api]
    description: >
      Install the packed package into a clean directory outside the repository, import only its published entry,
      exercise the complete address and message loop plus a multi-process shared-database case, and inspect the
      failures deliberately triggered by invalid composition.
    expected: >
      The installed entry completes initialize, enqueue, dequeue, listPending, readMessages, and retire; independent
      processes observe one committed database; expected failures are ProtocolError values carrying only codes from
      the frozen inventory, and no database failure is represented as an empty successful result.
---
# session protocol errors loss

Measure through the package installed from its tarball, never through a source-path import. The result transcript
records operation counts, process counts, and the observed error codes so an empty or unmeasured population cannot
look like a pass.
