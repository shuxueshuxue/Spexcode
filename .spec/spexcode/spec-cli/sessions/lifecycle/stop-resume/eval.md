---
scenarios:
  - name: resume-refuses-a-live-agent-and-restores-a-stopped-one
    tags: [backend-api, cli]
    code: [spec-cli/src/sessions.ts#stopSessionUnlocked, spec-cli/src/sessions.ts#resumeSessionUnlocked]
    description: >
      Against a live governed session, call resume (API and CLI). Then `spex session stop <id>`, read the record and
      liveness, and resume it; read the lifecycle, proposal, and note before and after.
    expected: >
      Resume against a live agent answers 409 / a loud refusal and kills nothing. Stop leaves worktree, branch, and
      record, stamps `stopped`, reads `offline`, and drains a queued slot; resume relaunches `--resume` into the
      same conversation, clears `stopped` exactly once after its readiness fence, settles an `active` lifecycle to
      `idle`, and leaves every deliberate declaration and proposal untouched.
---
# measuring stop-resume

The guard and the symmetry are one scenario because the same real session exercises both sides.
