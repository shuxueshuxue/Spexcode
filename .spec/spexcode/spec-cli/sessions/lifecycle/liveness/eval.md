---
scenarios:
  - name: failed-probe-reads-unknown-never-offline
    tags: [backend-api, cli]
    code: [spec-cli/src/sessions.ts#liveness]
    description: >
      With a live governed session, make the tmux snapshot time out (wrap the tmux binary so the bounded probe
      exceeds its budget) and read `/api/sessions` and `spex session ls`; then unlink the live agent's socket path
      while its process keeps running and read again.
    expected: >
      A timed-out probe yields `unknown`, rendered probe-failed, with the row retained and neither relaunch entry
      offered; an unlinked socket under a still-answering `agent.pid` also reads `unknown`, never `offline` — only a
      corpse both witnesses agree on is offline.
---
# measuring liveness

The rule under test is that a probe that cannot tell never becomes a death a supervisor acts on.
