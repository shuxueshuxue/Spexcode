# e2e — remote session monitoring (2 machines)

A non-forgiving end-to-end test for the [[remote-client]] refactor: the `spex` CLI's read/control verbs
route through the backend, so a client on machine **A** monitors and drives sessions whose backend + tmux
live on machine **B**. It is host-agnostic — you supply the two machines; no hosts/credentials live here.

The "agent" pane is a scripted screen, not Claude: the contract under test is the broker/transport (does a
read/control verb correctly cross the wire to the single backend actor), which is independent of what runs in
the pane. A touched rendezvous-socket path makes the session read `working` so `send` reaches a real
(non-Claude) socket and must fail **loud** (502) — the dead-dispatch contract.

## Run

On **B** (the backend host) — stand up a backend + sessions in a throwaway repo:

```bash
SPEX_CLI=/path/to/spec-cli PORT=8799 TMUX_SOCK=spexe2e WORK=/tmp/spex-e2e/repo NONCE=run-$RANDOM \
  bash e2e/host-setup.sh        # prints SID_A, SID_B, NONCE
```

From **A** (the client) — tunnel to B's backend port, then assert through it:

```bash
ssh -fN -L 8788:127.0.0.1:8799 <B>           # the API has no auth; the tunnel is the boundary
SPEX_CLI=/path/to/spec-cli API_URL=http://127.0.0.1:8788 \
  SID_A=<from B> SID_B=<from B> NONCE=<from B> bash e2e/client-assert.sh
```

Same-machine smoke: run both with `API_URL=http://127.0.0.1:$PORT`.

## What it proves (all must pass; none is softened)

1. **Provenance** — the board over the wire carries random uuids only B created (a localhost backend can't
   satisfy it; exit-0 alone is never trusted).
2. **Capture crosses the wire** — the live pane text contains B's unique nonce.
3. **Fail ≠ empty (offline)** — a known-but-tmux-dead session is a loud 409, not blank+exit0.
4. **Fail ≠ empty (unknown)** — a bogus id is 404 → exit 2, never blank.
5. **No backend fails loud** — a dead `SPEXCODE_API_URL` errors, never a silent local fallback.
6. **Send fails loud** — a dispatch the backend can't confirm accepted surfaces 502 → non-zero.
7. **Prompt crosses the wire** — the originating prompt is readable from the client.
8. **Watch crosses the wire** — a bounded watch streams B's session (poll source is the remote backend).

Producers (`done`/`ask`/`block`/`idle`) are deliberately NOT routed — verify separately that they still write
`.session` with no backend reachable.
