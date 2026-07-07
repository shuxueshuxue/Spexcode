---
scenarios:
  - name: rawkey-batch-preserves-strike-order
    tags: [backend-api]
    description: >-
      Measure the ordering contract of the raw-key channel through the REAL product surface: the
      `POST /api/sessions/:id/rawkey` route the dashboard's type mode drives. Start the real backend against a
      tmux socket, create a session running a shell, then send a long run of known distinct printable
      characters (e.g. the 26 lowercase letters `abcdefghijklmnopqrstuvwxyz`) the way the client coalescer
      hands them over — as ONE ordered `keys` batch in strike order — over the real HTTP route. The backend
      `rawKey` delivers them with one awaited `tmux send-keys -l` per token, in array order. Then read back
      what the pane actually received (`tmux capture-pane -p` on the prompt line) and compare the received
      character sequence to the sequence sent. (The client half of the contract — coalescing fast keystrokes
      into that single in-flight ordered batch so batches can't overtake — lives in `SessionInterface.jsx`;
      this backend-api scenario measures the delivery half the route owns.) File with `spex yatsu eval
      nav-mode-key-ordering --scenario rawkey-batch-preserves-strike-order --result <txt>`.
    expected: >-
      The characters land in the pane in EXACTLY the order they were sent — `abc…z` reads back as `abc…z`,
      never `acb…` or any transposition. Because `rawKey` sends one awaited `send-keys` per token in array
      order, the array IS the order; and because the client keeps only one batch in flight, batches cannot
      overtake each other either. Zero loss = the captured prompt line equals the struck sequence character-
      for-character, with none dropped, duplicated, or reordered.
---
# yatsu.md — nav-mode-key-ordering

The contract is measured through the **real raw-key channel** the dashboard's type mode uses —
`POST /api/sessions/:id/rawkey` into a live tmux pane — not an internal probe or a stubbed sender. YATU: fire
a known character sequence the way the client coalescer sends it (one ordered batch / a coalesced burst), then
read the pane back with `tmux capture-pane` and check the received order against the struck order.

The loss is **keystroke scrambling under fast typing**: independent fire-and-forget forwards race (browser,
server, and each `tmux send-keys` all parallel), so `a b c` can reach the pane as `a c b`. Zero loss is the
one-in-flight-batch, sent-in-array-order path delivering every key in exactly its strike order — order is the
whole contract of a keystroke channel, and a single character out of place is a full failure of it.
