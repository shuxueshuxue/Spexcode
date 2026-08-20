---
scenarios:
  - name: installed-package-runs-the-complete-protocol-loop-across-processes
    tags: [backend-api]
    description: >
      Pack and install the package in a clean external consumer, run initialize, enqueue, listPending, dequeue,
      readMessages, and retire through the installed entry, then use two independent writer processes and a third
      reader process on the same absolute database path.
    expected: >
      Each of the six operations produces its specified state transition, retirement preserves history, both writer
      processes commit distinct messages, and the third process observes exactly both messages in stable order from
      the same database.
---
# session protocol production engine loss

The reading goes through the installed package's public object and real operating-system processes. Its transcript
names every operation and reports expected and observed message totals; helper-only success is not evidence.
