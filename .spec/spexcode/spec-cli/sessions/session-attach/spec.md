---
title: session-attach
status: active
hue: 280
desc: The human escape hatch — `spex session attach <SEL>` foreground-attaches the worker's real tmux; local-only, terminal-only, fail-loud.
code:
  - spec-cli/src/attach.ts
---

# session-attach

## raw source

Every worker IS a tmux session on the backend's private socket, and the most natural act toward one —
sitting in it — was the one act the CLI didn't expose: a human wanting to watch or rescue an agent had to
hand-assemble the `tmux -L spexcode attach …` incantation. The design stance (the human's own): don't try
to handle every anomaly programmatically — many problems the user solves by just entering the tmux.
`attach` is that universal escape pod, as a verb.

## expanded spec

**The verb.** `spex session attach <SEL>` resolves the selector through the shared grammar
([[session-selectors]] — id · prefix · node · branch, `none`/`ambiguous` loud like every control verb),
prints one detach hint (`C-b d` — the session keeps running), then foreground-attaches the terminal to the
worker's real tmux window and blocks until the human detaches or the session ends, exiting with tmux's
status. No wrapping, no filtering — the human gets the worker's actual screen and keyboard.

**A human verb, guarded as one.** Attach is interactive and blocking — the `watch` of terminals. An agent
must never run it inside a turn (it freezes the turn); the agent-shaped moves are `capture` (read),
`send` (prompt), `rawkey` (drive a TUI). The help entry carries that caveat the way `watch`'s does, and
the verb itself refuses a caller with no terminal (stdin/stdout not a TTY) up front, naming those
alternatives — an agent that runs it anyway gets the pointer, not a hung turn.

**The deliberate LOCAL exception.** Every other read/control verb is a thin backend client
([[remote-client]]); attach cannot be — a terminal isn't brokered over HTTP, and the tmux server lives on
the backend's machine. So the verb asserts locality FIRST: loopback or any address this host owns passes;
a `SPEXCODE_API_URL` pointing at another machine fails loud with the reason and the remote-capable
alternatives (capture/send/rawkey, or ssh there and attach) — never a silent fallback onto a local tmux
socket that holds no sessions. Attaching a tmux CLIENT to the same server is tmux's native multi-client
support, not a second actor on the socket, so the single-actor rule survives intact.

**Offline is loud.** A selector that resolves to a session with no live tmux (offline/closed-out runtime)
errors distinctly — naming `reopen` as the repair — because a dead attach must never read as an empty
screen.
