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

## the generated extension — a thin host over the shared runtime

The extension is a THIN HOST over the shared shim runtime ([[shim-runtime]], embedded verbatim by the
generator): the payload synthesis into `dispatch.sh pi <Event>`, the block-verdict parse, and the rendezvous
socket server are the runtime's, one source shared with every generative shim. What this generator declares
is pi's OWN half, chosen so the rest of the product needs NO pi branch:

- **The event mapping.** pi's five lifecycle events onto the claude vocabulary — `session_start`→SessionStart,
  `input`→UserPromptSubmit, `tool_call`→PreToolUse, `tool_result`→PostToolUse, `agent_end`→Stop (with
  `agent_settled` as the consume-once backstop for a pending blocked Stop, never a duplicate) — with
  `tool_name` capitalized to Claude's names and pi's `path` normalized onto `file_path`. Because every payload
  arrives claude-shaped, `hooks/harness.sh` needs no pi parse arm — `pi` joins the claude family through the
  default case, exactly like `plugin`. pi has no idle/attention or failed-stop event, so
  Notification/StopFailure are genuinely absent (the codex gap, not a TODO).
- **The verdict consumers.** The runtime decides blocked (exit 2) and extracts the reason (stdout
  decision:block JSON, stderr for a bare exit-2 handler — [[shim-runtime]]'s one contract); pi consumes that
  verdict through its own two channels. `tool_call` blocks via pi's typed return (`{ block: true, reason }`).
  For Stop there is no blocking return, so Stop rides the runtime's `dispatchStop` from **`agent_end`** (the
  normal dispatch: pi awaits agent_end listeners inside the run loop and a message they queue drains as the
  SAME awaited prompt's continuation — so a block's teach re-enters before a one-shot host disposes, never
  as the orphaned settle-time prompt whose late inject threw "extension ctx is stale", the reproduced
  wedge), with **`agent_settled`** as the CONSUME-ONCE backstop: a naturally allowed agent_end leaves no
  pending state and settle dispatches nothing (exactly one gate entry per stop); only a blocked agent_end
  arms the pending bit (`stopPending`), and settle — which fires exactly once per prompt, after every
  drain — consumes it with one `stop_hook_active`-flagged dispatch whose escape paths always allow (a
  subprocess write, no inject), so a one-shot process exits DECLARED even when the drained continuation's
  own agent_end never re-reaches the extension (the measured dispatched-run gap). On block the gate's
  reason is **sent back in as a user message** (awaited `pi.sendUserMessage`, deliverAs steer) — pi's
  equivalent of claude's Stop-hook continuation — and a genuinely uninjectable host is reported loud by
  the runtime, with the one-shot recovery as the out-of-process cover.
- **The rendezvous inject.** sessions.ts already exports `CLAUDE_BG_RENDEZVOUS_SOCK=<rvSock(id)>` to every
  `ownsRendezvous` launch; the runtime's server binds it and pi supplies only the inject —
  `sendUserMessage({deliverAs: steer})`, always able, so no reject gate. claude's delivery
  (`deliverViaRendezvous`, parse-confirmed by the repaint barrier) and claude's liveness (the socket-LISTENER
  connect probe) work for pi **unchanged** — `ownsRendezvous: true`, zero new transport code; the runtime's
  server is multi-connection, so a probe can never kick a delivery mid-parse.

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

## headless — the one-shot `-p` form

pi's headless capability (`piHeadlessOps`) is [[harness-adapter]]'s shared one-shot builder instantiated
with pi DATA — no pi-specific headless code exists. The launcher's `headlessCmd` is the complete one-shot
invocation (`pi -p`), embedded whole; the ordinary launch tail pins `--session-id <record id>` exactly as
interactive, so an injected next turn continues that same conversation with `--session <record id>` (loud
failure when the session file is gone — the same semantics interactive resume chose). `--approve` rides the
launch AND every injected turn: each turn is a FRESH pi process that must load the project extension with
zero prompts, so the one-run trust defence recurs per process, not per session. The extension itself is
mode-blind — a headless launch omits the rendezvous env (rvEnv's headless bypass), the runtime's rendezvous
server simply never binds, and the dispatch events still fire — so hooks, stop-gate, and attribution are
unchanged. One print-mode fact shapes the Stop path (REPRODUCED through a real dispatched worker, pi
0.80.10: record wedged `active`, rc=97 after both recovery turns, "This extension ctx is stale after
session replacement or reload" on every inject past the first): `pi -p` disposes its session once the
initial prompt resolves, so any gate continuation not part of that awaited prompt is an orphan that loses
its inject — which is what the Stop binding pair closes: agent_end drains the teach inside the awaited
prompt, and the settle backstop consumes a still-pending block with one flagged dispatch (a subprocess
write, no inject) so disposal only ever happens after the record is declared; a lost inject is still
reported loud instead of thrown into the host, and the shared one-shot undeclared-exit recovery remains
the out-of-process cover.
Live-verified (pi 0.80.10, 2026-07-18): the project extension loads under `-p` and fires
session_start/input/agent_end/agent_settled; `-p --session-id` creates the pinned session; `-p --session`
recalls first-turn content (the same conversation); a vanished session id exits non-zero with the error
named.
