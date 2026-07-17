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
client — so the "shim" this adapter materializes is not a settings JSON but a generated plugin, and
that plugin plays TWO roles at once:

- **hook bridge** — it subscribes to opencode's event bus and re-emits each event as a Claude-SHAPED
  payload (`session_id` = the governed record id from the launch env, Claude tool names, `file_path`)
  piped into `dispatch.sh opencode <Event>`. Because the payload is claude-family by construction,
  `harness.sh` needs no opencode parse arm — the default (claude) branch handles it, exactly like the
  `plugin` bundle form. A blocking hook outcome (exit 2 / `decision:"block"`) is honored in-process:
  a PreToolUse block throws (opencode aborts the tool call), a Stop block re-injects the gate's reason
  as a follow-up prompt, closing the stop-gate loop. Tool events from a non-root opencode session are
  stamped `agent_id` so the subagent discriminator keeps a parent's declared state safe, same as claude.
- **rendezvous daemon** — it binds SpexCode's per-session rendezvous socket (the path the launch env
  hands every rendezvous-owning harness) and answers the reply/repaint mini-protocol. That makes
  `ownsRendezvous: true` LITERALLY true — the claude adapter's `deliver` (parse-confirmed atomic write)
  and socket-listener liveness are reused unchanged; there is no opencode-specific transport code.
  The daemon's side of that contract: confirmation means PARSED, not processed — the reply+repaint
  chunk is parsed and `repaint-done` written in one synchronous pass, with the prompt injection (a
  whole model turn, on the SDK) running behind the confirm, so a concurrent probe connect (the board
  fires one per snapshot) can never kick the connection between parse and confirm.

The remaining divergences are ordinary adapter facts: launch is a tail-branching script (a prompt tail
launches `--prompt`, a `--resume <id>` marker re-attaches `--session <id>` — the codex marker pattern);
opencode mints its own session id, so the plugin's first event calls `spex internal opencode-capture`
to store it as `harness_session_id` for resume; contract file is `AGENTS.md` (native); skills and
agents materialize under `.opencode/`; trust is a no-op (`--auto` in the default launcher command is
the zero-prompt mechanism). Liveness prefers the socket listener and falls back to the launch-registered
agent pid, so a plugin that failed to load still reads honestly from the process signal.

Verification status: the mechanical layer (materialize artifacts, shim → dispatch.sh event flow, launch
script shape, clean/dematerialize inverse, deliver under probe pressure) is what tests cover; the live
deliver path is measured through a real dispatched opencode worker (the `deliver-second-message`
scenario), and the full worker-lifecycle e2e reading remains the open item.
