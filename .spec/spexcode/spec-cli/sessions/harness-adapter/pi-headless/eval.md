---
scenarios:
  - name: pi-headless-real-loop
    description: >-
      Through a running backend and the real `pi-headless` launcher, create a session, observe the initial
      text-mode response, send a prompt after the turn is idle, then start a long tool turn and send a second
      prompt while the rendezvous listener is live.
    expected: >-
      The initial turn completes in pi's default text mode, idle delivery resumes the exact same session with
      `pi -p --session <id>`, and the active-turn delivery uses the existing rendezvous steer path exactly once;
      the public record remains online and reports `{ headless: true, messageStream: false }`.
    tags: [backend-api, cli]
    code: [spec-cli/src/pi-headless.ts]
  - name: pi-headless-close-residue
    description: Close the real pi-headless session through the public session API and inspect its process, tmux, worktree, sockets, and record store.
    expected: The controller and pi children stop, both controller and rendezvous sockets are gone, and the session worktree, branch, record, and store leave no residue.
    tags: [backend-api, cli]
    code: [spec-cli/src/pi-headless.ts]
---

Measure with a real `pi-headless` launcher and public `spex session` verbs. Use a transcript for the backend/CLI
loop and include the exact session id, listener observations, and response markers; close is measured after the
session has been retired and the residue sweep has completed.
