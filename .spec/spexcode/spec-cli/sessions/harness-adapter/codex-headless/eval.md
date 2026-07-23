---
scenarios:
  - name: codex-headless-real-loop
    description: Through a running backend and the real `codex-headless` launcher, create a session, wait for the initial app-server turn to finish, then send a follow-up to the idle session.
    expected: The session is online with `{ headless: true, messageStream: false }`; its pane has no resident Codex TUI after the first turn, and the idle send is accepted as a new app-server `turn/start` on the same thread.
    code: [spec-cli/src/codex-headless.ts]
    tags: [backend-api, cli]
  - name: codex-headless-live-steer
    description: While a real codex-headless app-server turn is in progress, send a second prompt through the public session command.
    expected: The delivery is accepted by `turn/steer` on the owned thread and no second Codex process or TUI is spawned.
    code: [spec-cli/src/codex-headless.ts]
    tags: [backend-api, cli]
  - name: codex-headless-close-residue
    description: Close the real codex-headless session through the public session API and inspect its process, tmux, worktree, branch, sockets, and record store.
    expected: The session closes with no per-session process, pane, worktree, branch, record, or socket residue; the shared project app-server is not mistaken for session-owned residue.
    code: [spec-cli/src/codex-headless.ts]
    tags: [backend-api, cli]
---

Measure through one real `codex-headless` launcher and the public `spex session` verbs. Store backend/CLI output
as transcript evidence; the idle-send scenario must include the exact same-thread `turn/start` acceptance, and
the live-steer scenario must include `turn/steer` acceptance. File readings only after the implementation commit
so the evidence `codeSha` names the measured tree.
