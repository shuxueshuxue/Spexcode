---
title: nav-mode-key-ordering
status: active
hue: 290
desc: Type-mode keystrokes reach the pane in the order they were struck — no scrambling under fast typing.
---
# nav-mode-key-ordering

In [[session-console]]'s **type mode** (the raw-keystroke takeover; this node's id keeps the channel's
older internal "nav" name) every keystroke forwards raw to the live pane. When those forwards
are independent, fire-and-forget requests, fast typing **scrambles**: the browser fires the POSTs in
parallel, the server handles them in parallel, and each `tmux send-keys` execs on its own — so nothing
orders `a b c` against `a c b` by the time they hit the pane. Order is not incidental here; it is the
whole contract of a keystroke channel. This node holds that contract across the two surfaces that realise
it, so neither can regress it alone.

## one in-flight batch, sent in order

The client ([[session-console]]'s `SessionInterface.jsx`) keeps **one request in flight per session** and
**coalesces** the rest. The first key flushes immediately, so typing stays snappy. Any keys struck while
that round-trip is open **queue in strike order** and go out together as **one ordered batch** when it
returns. Because only one batch is ever in flight, batches cannot overtake each other, and within a batch
the array *is* the order. This also bounds latency on a remote link: N fast keys cost roughly two
round-trips (the first key, then one coalesced batch), not N serial round-trips.

The backend ([[sessions-core]]'s `rawKey`) accepts that **ordered array** (or a single key, unchanged) and
sends it with **one awaited `tmux send-keys` per token, in array order** — the same per-token encoding as
before (named keys, `-l` literals, `C-`/`M-`/`S-` combos), just sequenced. An unknown token is skipped
without dropping the rest.

## why not the control socket

This stays on the raw `tmux send-keys` path, never the rendezvous prompt socket — the socket injects a
*whole prompt* and cannot drive an interactive TUI select menu, which is exactly what type mode exists for
(see `rawKey` in [[sessions-core]]). Ordering is fixed *within* the raw channel; it does not move raw keys
onto the prompt channel or touch the read-only terminal socket's semantics.

## no source of its own

Like its parent [[term-input]], this node governs no files directly: the client coalescer lives in
[[session-console]]'s `SessionInterface.jsx` and the ordered batch delivery in [[sessions-core]]'s
`rawKey`/`/api/sessions/:id/rawkey`. It exists so the ordering guarantee reads as one contract spanning
both, not as an unstated detail either surface could quietly drop.
