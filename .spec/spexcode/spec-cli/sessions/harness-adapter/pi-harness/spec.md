---
title: pi-harness
status: active
hue: 290
desc: The pi adapter (@earendil-works/pi-coding-agent) — pi's harness-specific machinery behind the one Adapter seam. The shim is a generated TypeScript extension (pi has no external hook binding); prompt delivery and liveness reuse claude's rendezvous channel wholesale.
code:
  - spec-cli/src/pi-harness.ts
related:
  - spec-cli/src/harness.ts
  - spec-cli/src/slash-commands.ts
  - spec-cli/src/pi-harness.test.ts
  - spec-cli/hooks/dispatch.sh
  - spec-cli/hooks/harness.sh
---

# pi-harness

pi is the third native harness. Its adapter (`piHarness` in [[harness-adapter]]'s `harness.ts`) encodes one
governing observation: **pi is claude-shaped at both ends** — the caller pins the session id at launch and the
shim lives in the worktree — so nearly every divergence point collapses onto the claude pattern, and the one
genuinely new fact lives here in `pi-harness.ts`: **pi has no external hook binding at all.** Its lifecycle
surface is an in-process TypeScript extension API, so pi's shim is a **generated extension**
(`.pi/extensions/spexcode.ts`, run natively by pi) that this node's file produces.

## the generated extension — pi's face of dispatch.sh

The extension does three jobs, each chosen so the rest of the product needs NO pi branch:

- **Event forwarding.** It maps pi's five lifecycle events onto the claude event vocabulary and pipes each to
  `dispatch.sh pi <Event>` with a **claude-SHAPED synthesized payload** (`session_id`, `cwd`,
  `hook_event_name`, `tool_name` in Claude's capitalized vocabulary, `tool_input.file_path` from pi's `path`):
  `session_start`→SessionStart, `input`→UserPromptSubmit, `tool_call`→PreToolUse, `tool_result`→PostToolUse,
  `agent_settled`→Stop. Because the payload arrives claude-shaped, `hooks/harness.sh` needs no pi parse arm —
  `pi` joins the claude family through the default case, exactly like `plugin`. pi has no idle/attention or
  failed-stop event, so Notification/StopFailure are genuinely absent (the codex gap, not a TODO).
- **Block bridging.** pi's `tool_call` blocks via a typed return (`{ block: true, reason }`); dispatch.sh
  blocks via exit 2 + stderr. The extension bridges: exit 2 → return the block with the gate's stderr as the
  reason. For Stop there is no blocking return — `agent_settled` fires after the run is already settled — so
  the stop-gate's exit-2 stderr is instead **sent back in as a user message** (`pi.sendUserMessage`), which
  triggers a new turn carrying the gate's instruction: pi's equivalent of claude's Stop-hook continuation.
  The gate exits 0 once satisfied, so the loop terminates the same way claude's does.
- **The rendezvous channel.** sessions.ts already exports `CLAUDE_BG_RENDEZVOUS_SOCK=<rvSock(id)>` to every
  `ownsRendezvous` launch; the extension binds a line-JSON server on that path speaking the reclaude
  mini-protocol (`{type:reply}` → `sendUserMessage`, `{type:repaint}` → `repaint-done`). So claude's
  delivery (`deliverViaRendezvous`, parse-confirmed by the repaint barrier) and claude's liveness (the
  socket-LISTENER connect probe, already fired for every windowed session) work for pi **unchanged** —
  `ownsRendezvous: true`, zero new transport code. Unlike reclaude the server accepts concurrent
  connections, so a probe can never kick a delivery mid-parse.

The extension also exports `PI_SESSION_ID` (the adapter's `sessionEnvVar`) at `session_start`, so tool
subprocesses — and the agent's own `spex` calls — inherit their session identity; the pinned `--session-id`
makes that id equal the governed record id, claude-style, so no alias step is needed anywhere.

## trust — one saved decision plus a one-run flag

pi gates every project-local resource (`.pi/extensions`, `.pi/skills`, `.pi/prompts`, `.pi/settings.json`)
behind per-directory **project trust**: decisions live in `~/.pi/agent/trust.json` as a flat
`{ "<canonical dir>": true|false }` map, and the closest decision on the cwd's parent chain wins. An
untrusted project never loads our extension — zero hooks, silently — so `writeTrust` stamps
`<mainCheckout>: true` there (nearest-parent lookup covers every `.worktrees/*` beneath it), and the launch
additionally carries `--approve` (pi's one-run trust override) as defence for worktrees outside the checkout.
The writer is idempotent and surgical: other projects' decisions untouched, a corrupt trust.json fails loud
rather than being clobbered, and `removeTrust` deletes only a `true` we could have written — never a user's
saved "do not trust". pi hardcodes its config dir, so `SPEXCODE_PI_AGENT_DIR` is purely our test seam.

## what stayed generic

Registering the adapter forced ONE generalization in the seam itself: the shim payload field is now
`content`, not `json` — a shim is whatever file THAT harness discovers (hooks JSON for claude/codex, a `.ts`
extension for pi), and materialize writes it without knowing which. Launch (`pi --approve --session-id <id>
"<prompt>"` — the TUI submits the trailing message itself), resume (`--session <id>`, failing loud when the
session file is gone rather than silently minting an empty one), the `/` menu (built-ins extracted from the
installed pi's own command table, in `slash-commands.ts`), skills (`.pi/skills`), and the AGENTS.md contract
file all ride existing seams with one-line adapter answers.
