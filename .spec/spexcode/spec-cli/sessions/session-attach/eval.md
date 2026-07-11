---
scenarios:
  - name: attach-live-detach
    description: >
      From a REAL terminal on the backend machine (a wrapper tmux pane works — unset TMUX inside it),
      run `spex session attach <SEL>` against a live session. The terminal must show the worker's actual
      tmux screen (compare with `spex session capture <SEL>`); C-b d must detach, leaving the worker
      running, with the pre-attach detach hint visible in the shell scrollback.
    expected: >
      A one-line hint ("attaching to <id> — detach with C-b d") prints, the worker's real screen takes
      over the terminal, C-b d returns to the shell ("[detached …]"), and the worker session is unharmed
      (still online, pane unchanged).
    tags: [cli]
  - name: remote-fail-loud
    description: >
      With SPEXCODE_API_URL pointing at ANOTHER machine's backend, run `spex session attach <SEL>`.
      Attach is local-only (the tmux server lives on the backend machine), so the guard must refuse
      before touching the network.
    expected: >
      Exit 2 with a message naming the remote URL, the reason (a terminal can't be attached over HTTP),
      and the alternatives — attach on that machine (ssh) or capture/send/rawkey remotely. Never a silent
      attach onto the LOCAL tmux socket.
    tags: [cli]
  - name: no-tty-agent-refusal
    description: >
      Run `spex session attach <SEL>` on a LIVE session without a terminal (piped/agent context — the
      way an agent would wrongly run it inside a turn).
    expected: >
      Refused up front with exit 2: the message says attach is interactive and blocking, tells an agent
      never to run it in a turn, and points at capture/send/rawkey — not tmux's bare "not a terminal".
    tags: [cli]
  - name: offline-fail-loud
    description: >
      From a real terminal, attach a selector that resolves on the board but has NO live tmux session
      (an offline session; reproducible with the SPEXCODE_TMUX test override pointed at an empty socket).
    expected: >
      Non-zero exit with a loud "offline — no live tmux session to attach" naming `spex session reopen`
      as the repair. A dead attach must never read as an empty screen.
    tags: [cli]
---

Measured YATU through the real CLI (`spex session attach …`), never by reasoning about attach.ts: the
happy path needs a genuine tty, so drive it from a wrapper tmux pane (`tmux -L <scratch> new-session`,
`env -u TMUX` inside), capture that pane for evidence, and detach with `send-keys C-b d` to the wrapper.
The guard scenarios are plain shell runs whose transcripts (stderr + exit code) are the evidence.
