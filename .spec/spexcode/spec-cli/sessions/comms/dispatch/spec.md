---
title: dispatch
status: active
hue: 280
desc: Deliver a prompt through the resolved harness adapter's control channel — fail-loud, never PTY prompt typing — plus hard interrupt and the merge intent.
related:
  - spec-cli/src/sessions.ts
  - spec-cli/src/index.ts
  - spec-cli/src/client.ts
  - spec-cli/src/cli.ts
  - spec-cli/src/session-merge-dispatch.api.test.ts
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/test/session-toolbar.e2e.mjs
---

# dispatch

## raw source

Dispatching a **prompt** to a session — a message, a continue, the merge instruction —
is **control**, separate from the tmux pane, which is **display only**. Control must be **scoped** (only
sessions this product launched) and **fail-loud** (a dead dispatch is seen, never silently degraded to
typing into the pane). And **merge is an intent the human expresses, not a server-run git script.**

## expanded spec

Prompt control goes through the resolved [[harness-adapter]] only, never PTY prompt typing. Every adapter's
address is derived from the governed session id or its owned native id, so control reaches only sessions this
product launched. Interactive Claude/pi/opencode use the rendezvous protocol, Codex uses its app-server, and
[[claude-headless]] uses a controller that writes Claude-native stream-json stdin. Multi-line prompts and Enters
therefore cannot be corrupted the way `tmux send-keys` could.

**Acceptance is the append; the handover is the adapter, retried.** `sendText` normally appends one `sent` line
to the target's durable log and enqueues the message on that session's delivery queue ([[delivery-queue]])
inside one hold of its record lock ([[session-timeline]]), and reports success on that write. The one refusal
before that append is a **stranded transport**: the resolved adapter proves its native prompt transport
unreachable while the independent registered pid proves its worker still lives. That combination cannot
self-heal, so the response names the transport cause, existing queued count, and the raw-key tmux bypass; it
adds neither history nor queue debt, and `/api/sessions/:id/input` is non-2xx. A merely unproven probe is not
stranded and keeps the ordinary queue retry, while a dead worker may be made addressable by resume. An accepted
message is drained immediately so a live agent sees it in its current turn; whatever that drain could not hand
over stays queued and is retried by the serve that owns the project root. A caller may provide one opaque delivery
key while retrying; canonical protocol idempotency binds that key to the original message and reports queued until
the adapter acknowledges handover, never appending a second prompt. The channel is the ONLY way a message
enters an agent, so it arrives in exactly the shape a human prompt does. There is no send-keys fallback, no PTY
prompt typing, and no hook-injected copy — a turn-boundary hook reports freshness and never carries conversation.
The one exception is an already-installed managed parent-watch notification: its authored child-state event must
cross the append boundary even when the parent's registered process is alive but its native transport is absent.
That notification still uses the ordinary parent queue and retry path; it is not reported as handed over until an
adapter accepts it, and it never weakens the stranded refusal for a caller's new prompt.

A prompt accepted from a human (the input route with no `from` session) is also the explicit re-entry for a waiting
turn: `asking` and inferred `idle` become canonical `active` at that same acceptance boundary. Agent-to-agent
messages and managed watch events keep the recipient's authored waiting state. Native terminal input follows the
same rule after the PTY write; mouse reports are navigation, not a prompt, and do not wake a session.

Locating the truth in the file is what dissolves the hardest failure this mechanism ever had. Claude's
rendezvous daemon keeps **ONE connection** and destroys the previous socket on every new connect,
discarding any received-but-unparsed line with it — and our own liveness probes ARE such connects, so a
probe landing in the write→parse window silently killed a "successfully sent" prompt (the field incident:
dashboard messages recorded `sent` with no trace in the claude transcript). The adapter now writes the reply
and an in-order repaint probe as one chunk: `repaint-done` proves parse, while a kick before it proves the
whole chunk was lost and permits a bounded same-`mid` retry. A still-open timeout is busy, not proof of loss,
and remains optimistic to avoid false failures on active turns. The durable append remains the acceptance
boundary and the queue entry is removed only after the adapter reports its handover outcome, so a proven kick
cannot silently clear the only pending attempt. **Acceptance still has exactly two outcomes: the bytes are in
the log, or they are not.**

That separation is also what a later refactor lost by collapsing the two questions back together. Removing the
adapter's receipt left nothing able to say a message had been handed over, so every message was replayed to the
agent at its next turn boundary in addition to arriving normally — each one delivered twice, and the duplication
read as intended behaviour because the contract had been rewritten to match the code. A receipt that decides
whether a debt is settled is not ceremony; it is the only thing standing between "retry until it lands" and
"show it again forever".

What remains loud is what genuinely cannot be recorded: an unknown session id, or a record the writer
refuses. Those still return a `DispatchResult {ok,error}` that propagates — `POST …/input` answers non-2xx,
`spex session send` prints it, `mergeSession` returns it. A **retired** session (its worktree gone) is not
one of them: its log still accepts the line, because a message that cannot be delivered must at least leave
a trace ([[session-timeline]]).

Hard interrupt is a sibling control operation, not a magic prompt. `spex session interrupt` calls the adapter's
interrupt capability through the backend; [[claude-headless]] sends native `control_request/interrupt` and
confirms the matching `control_response`. An adapter without that capability refuses loudly. Interrupt never
falls back to a signal or raw key that could target the wrong process.

Before a text prompt reaches that channel, the backend applies the SAME `surface: command` resolver [[launch]]
uses. A recognized leading `/<preset>` expands to the live plugin body, target placeholders, and remaining
free text; an unknown slash name passes through unchanged. Dashboard and CLI callers send the raw invocation
and never carry plugin bodies or a second interpreter. Raw-key input bypasses this resolver because keys are
terminal control, not an agent prompt.

**Merge is a dispatch, not a script.** `POST /api/sessions/:id/merge` and `spex session merge <id>` carry no
body, Git identifier, retry authority, or shell program. The server never runs Git. It appends one ordinary prompt
through `sendText`, then resumes and drains the session. The prompt is accepted for any existing governed session
with a branch; the agent's landing procedure owns the actual merge safety checks.

The prompt is deliberately short: merge the latest `main` into the session's branch in that session's own
worktree, resolve any conflict there and re-run the proof; land the completed branch atomically as one `--no-ff`
merge into `main`, never resolving a conflict in the shared main checkout; then verify that `main` advanced with
no merge left in progress and propose close when that is true. The agent owns every Git decision and the server
only owns durable prompt acceptance. Normal delivery-queue semantics remain: success means a timeline append;
an unavailable adapter leaves ordinary delivery debt. There is no second merge receipt, key, review snapshot, or
Git identity protocol.

**Creating or deleting a spec node is NOT a server op.** It is prompt-driven work the launched agent does
itself — the composer's board chords merely prefill a plain instruction ("create a new node under
`[[parent]]`…" / "delete `[[node]]`…"), and the agent authors or refactors-away the node like any other spec
work. The server never mutates the spec tree; it only launches. [[mentions]] keeps `@session` passive but owns
the exact `@new` worker dispatch after the containing prompt or thread write is durable. Ordinary `text` input
is prompt delivery; the Command Box's explicit `command` input kind is the control-plane caller, so its
selected session supplies the spawned worker's parent without giving shell `spex session send` dashboard lineage.

All faces reach the wire as **one route**, `POST /api/sessions/:id/input`, with `kind` the discriminator:
`kind:"text"` is the prompt delivery above; `kind:"command"` is Command Box text plus `@new` resolution using
`:id` as the parent originator; `kind:"keys"` is the **raw-key face** (`rawKey`), which keeps its
own `tmux send-keys` transport — the per-keystroke channel for driving the agent's TUI menus, carrying named
keys, printable chars, and `⌃`/`⌥`/`⌘` modifier combos (as `C-`/`M-`/`S-` tokens) so CLI remote control drives the
terminal, **not** a prompt fallback. The transport split (socket vs send-keys) is an implementation fact the
API deliberately does not surface; an unknown `kind` is a loud 400, never a guessed channel. The raw face is
the **last resort** everywhere it is taught (`spex session send <SEL> --keys`):
unstable by nature and able to confirm dangerous dialogs, so callers try a plain text send first.
