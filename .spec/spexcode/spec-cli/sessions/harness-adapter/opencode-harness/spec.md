---
title: opencode-harness
status: active
hue: 150
desc: The opencode adapter — SpexCode's third native harness. Its hook shim is a generated opencode PLUGIN that synthesizes Claude-shaped payloads into dispatch.sh and serves SpexCode's own rendezvous socket, so the claude runtime transport (deliver/liveness) is reused verbatim.
code:
  - spec-cli/src/opencode.ts
related:
  - spec-cli/src/harness.ts
  - spec-cli/src/materialize.ts
  - spec-cli/hooks/dispatch.sh
  - spec-cli/hooks/harness.sh
  - spec-cli/src/cli.ts
  - spec-cli/src/slash-commands.ts
  - spec-cli/src/opencode.test.ts
---

# opencode-harness

opencode (opencode.ai, the `opencode` binary) joins claude and codex as a native [[harness-adapter]]
implementation. The adapter's whole design is ONE trick: opencode has no shell-hook primitive, but it
auto-loads project PLUGINS (`.opencode/plugins/*.ts`) that run inside the agent process with an SDK
client — so the "shim" this adapter materializes is not a settings JSON but a generated plugin: a THIN
HOST over the shared shim runtime ([[shim-runtime]], embedded verbatim by the generator), which owns the
payload synthesis into `dispatch.sh opencode <Event>`, the block verdict (exit 2 + stdout decision:block
JSON — the reason parsed, never the escaped wire format), and the rendezvous socket server. The plugin's
own half plays two roles:

- **hook bridge** — it declares opencode's event-bus mapping (session.created → SessionStart,
  chat.message → UserPromptSubmit, tool.execute.before/after → Pre/PostToolUse, session.idle → Stop),
  with `session_id` = the governed record id from the launch env, Claude tool names, and `filePath`
  normalized onto `file_path`. Because the payload is claude-family by construction, `harness.sh` needs
  no opencode parse arm — the default (claude) branch handles it, exactly like the `plugin` bundle form.
  The runtime's verdict is consumed through opencode's own channels: a PreToolUse block throws (opencode
  aborts the tool call), a Stop block re-injects the gate's parsed reason as a follow-up prompt via the
  runtime's `dispatchStop`. The Stop dispatch starts from `session.idle`, but its full promise is deliberately
  NOT awaited by that event callback: opencode must finish publishing the just-completed assistant turn before
  `client.session.prompt` starts the blocked-stop continuation. Awaiting the injected turn inside the idle
  callback re-enters the same session before its final text is durably visible, allowing the continuation to
  declare success while the requested answer disappears. This scheduling is an opencode host fact, not a
  shared-runtime rule — pi's awaited `agent_end` continuation remains correct. The
  `stop_hook_active` loop-termination bit rides the payload so the gate's
  escape paths end the block loop instead of re-blocking until the host dies ([[shim-runtime]]), a lost
  inject reported loud. Tool events from a non-root
  opencode session are stamped `agent_id` so the subagent
  discriminator keeps a parent's declared state safe, same as claude.
- **rendezvous daemon** — the runtime's server binds SpexCode's per-session rendezvous socket (the path
  the launch env hands every rendezvous-owning harness) and answers the reply/repaint mini-protocol; the
  plugin supplies the inject (`client.session.prompt` into the root session) and the reject gate (no
  adopted session → reply-rejected before the repaint barrier, so a sender fails loud instead of
  confirming an undeliverable prompt). That makes `ownsRendezvous: true` LITERALLY true — the claude
  adapter's `deliver` (parse-confirmed atomic write) and socket-listener liveness are reused unchanged;
  there is no opencode-specific transport code. Confirmation means PARSED, not processed — `repaint-done`
  is written in the same synchronous parse pass, with the prompt injection (a whole model turn, on the
  SDK) running behind the confirm — and the server is multi-connection, so a concurrent probe connect
  (the board fires one per snapshot) can never kick a delivery at all.

The remaining divergences are ordinary adapter facts: launch is a tail-branching script (a prompt tail
launches `--prompt`, a `--resume <id>` marker re-attaches `--session <id>` — the codex marker pattern);
opencode mints its own session id, so the plugin's first event calls `spex internal opencode-capture`
to store it as `harness_session_id` for resume. A RESUMED session re-fires no bus event until poked,
so event-driven adoption alone would leave the rendezvous daemon rejecting every delivery: the resume
branches seed the plugin instead — `--resume` exports the owned id for rootSession, `--continue`
exports a marker that unlocks a bounded SDK session.list fallback (newest root session; gated on the
marker so a fresh launch can never adopt a stale conversation) — keeping a resumed worker steerable
with zero manual pokes. Contract file is `AGENTS.md` (native); skills and
agents materialize under `.opencode/`; trust is a no-op and the launcher command owns the permission policy.
Clean init seeds plain `opencode`; `--auto` is available only through an explicitly authored launcher profile,
never an adapter or init default. Liveness prefers the socket listener and falls back to the launch-registered
agent pid, so a plugin that failed to load still reads honestly from the process signal.

Verification status: the mechanical layer (materialize artifacts, shim → dispatch.sh event flow, launch
script shape, clean/dematerialize inverse, deliver under probe pressure, both resume seeds, the
stop-gate wire shape) is test-covered; the live layer is measured as a behavior matrix through real
dispatched opencode workers — stop-gate rejection re-injected and acted on, PreToolUse hook blocks
aborting tool calls in-process, ask-note, exactly-once deliver both idle and mid-turn, resume
continuity + steerability on both routes, dual-signal liveness across kill/relaunch, commit-gate
rejection, and zero close residue — each row filed as an eval reading on this node.
