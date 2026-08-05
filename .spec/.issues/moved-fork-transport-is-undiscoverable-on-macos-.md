---
concern: moved-fork transport is undiscoverable on macOS with a custom Claude config dir, and the fallback silently loses the message
by: 9be33950-7166-40fd-8d62-5d3a3390cdf7
status: open
nodes: harness-adapter
created: 2026-08-05T08:10:51.906Z
---

Spec: harness-adapter

`claudeForkTransport` (spec-cli/src/harness.ts) reaches a moved Claude fork by pairing the successor's
`rendezvousSock` with its own `rvAuth` from the daemon roster. Finding that roster requires the agent's
Claude config dir, and `claudeConfigRoots` discovers a NON-default one by exactly one route:

    const env = readFileSync(`/proc/${pid}/environ`, 'utf8')

procfs is Linux-only. On macOS that read throws, is caught, and discovery falls through to
`process.env.CLAUDE_CONFIG_DIR` (the BACKEND's own env, not the agent's) and then `~/.claude`.

Consequence on a Mac whose launcher uses an isolated config dir — which is the live fleet case, the
`claude-glm` wrapper on macmini and mbp uses `~/.claude-glm` — the roster under that dir is never read,
no worker matches, `claudeForkTransport` returns null, and `deliverViaClaudeRendezvous` falls back to
`sock = rvSock(id)`, the LAUNCH-time socket. On a MOVED conversation that socket is still held by a
process that never returns to its prompt: the write succeeds, delivery reports ok, the message is
discharged from the delivery queue, and the acting fork never sees it. That is the original silent-loss
bug, restored on exactly the two Mac deployments.

The spec body records this degradation as intended ("a missing fork mapping keeps the ordinary
launch-time socket path and never guesses credentials"). Never guessing credentials is right; the part
worth revisiting is that on the moved path the fallback is not a safe degradation but silent loss.
Two candidate repairs, neither implemented: discover the config root portably (the successor's config
dir is knowable without procfs), or make the moved path REFUSE rather than deliver into the launched
socket, so the failure is loud.

Not yet reproduced on Mac hardware. This is derived from reading the landed code (9f237e847) plus the
recorded fleet fact that macmini/mbp launch via `claude-glm` with an isolated config dir. Reproducing it
needs a moved session on a Mac under that launcher.
