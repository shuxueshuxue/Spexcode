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
  - name: installed-package-preserves-transaction-callback-errors
    tags: [backend-api]
    description: >
      Install the packed package in a clean external consumer, mutate an adopter table and enqueue inside one shared
      transaction, then throw a caller-owned error whose message resembles a SQLite failure. Exercise invalid SQL
      through the transaction object separately.
    expected: >
      The shared transaction rolls back both writes and returns the exact caller error instance without changing its
      name, code, or message, while invalid SQL is still reported as a classified ProtocolError.
---
# session protocol production engine loss

Readings go through the installed package's public object and real operating-system processes. Their transcripts
name the observed error identity and state totals as well as every operation; helper-only success is not evidence.
