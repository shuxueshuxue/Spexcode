---
scenarios:
  - name: dead-listener-reads-offline-within-seconds
    tags: [backend-api, cli]
    code: [spec-cli/src/harness.ts#claudeHarness]
    description: >
      In an isolated store, dispatch a governed Claude session, wait for `online`, then SIGKILL the agent so its
      rendezvous socket FILE stays on disk. Poll `spex session ls` and `/api/sessions` liveness; then resume.
    expected: >
      Liveness reads `offline` within seconds even though the socket path still exists — a connect() is refused,
      the file's presence never reads online; resume relaunches `--resume` into the same conversation and reads
      `online` again. No product path classifies the socket by its pathname.
---
# measuring claude-rendezvous

The contract is a connect-probe, not a file check, so the measurement leaves the stale file in place on purpose.
