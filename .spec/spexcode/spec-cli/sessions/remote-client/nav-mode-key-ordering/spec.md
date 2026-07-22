---
title: nav-mode-key-ordering
status: active
hue: 290
desc: Last-resort CLI raw-key batches reach the pane in the order supplied, without racing independent tmux writes.
---

# nav-mode-key-ordering

`spex session send --keys` is the manager's last-resort path for unwedging an interactive TUI that cannot
accept an atomic prompt. Its ordered key array is one request, and the backend awaits one `tmux send-keys`
operation per token in array order. Batches therefore cannot scramble `a b c` into `a c b`; unknown tokens
are skipped without dropping later valid tokens.

This channel is CLI remote control, not the dashboard's normal terminal input. [[terminal-input]] uses xterm's
native ordered data on the visible terminal WebSocket, while this fallback retains the explicit named-key and
`C-`/`M-`/`S-` vocabulary documented by its parent [[remote-client]]. Both preserve order, but they do not
share a client coalescer or pretend to be the same transport.

The node owns no source directly: its backend realization is [[sessions-core]]'s `rawKey` behind
`POST /api/sessions/:id/input {kind:'keys'}` and its CLI surface is [[remote-client]].
