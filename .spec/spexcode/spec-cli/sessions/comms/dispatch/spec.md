---
title: dispatch
status: active
hue: 280
desc: Deliver a prompt through the resolved harness adapter's control channel — fail-loud, never PTY prompt typing — plus hard interrupt and the merge intent.
related:
  - spec-cli/src/sessions.ts
---

# dispatch

## raw source

Dispatching a **prompt** to a session — a message, a continue, the merge instruction —
is **control**, separate from the tmux pane, which is **display only**. Control must be **scoped** (only
sessions this product launched) and **fail-loud** (a dead dispatch is seen, never silently degraded to
typing into the pane). And **merge is an intent the human expresses, not a server-run git script.** A
dispatched prompt states only the **task**; the git flow's mechanics are carried by product **mechanism**,
not restated in every prompt, so the prompt and the flow never duplicate.

## expanded spec

Prompt control goes through the resolved [[harness-adapter]] only, never PTY prompt typing. Every adapter's
address is derived from the governed session id or its owned native id, so control reaches only sessions this
product launched. Interactive Claude/pi/opencode use the rendezvous protocol, Codex uses its app-server, and
[[claude-headless]] uses a controller that writes Claude-native stream-json stdin. Multi-line prompts and Enters
therefore cannot be corrupted the way `tmux send-keys` could.

**Acceptance is the append; the handover is the adapter, retried.** `sendText` appends one `sent` line to the
target's durable log and enqueues the message on that session's delivery queue ([[delivery-queue]]) inside one
hold of its record lock ([[session-timeline]]), and reports success on that write — a sender learns whether the
message was accepted, never whether a socket was reachable. It then drains the queue immediately, so a live
agent sees the message in its current turn; whatever that drain could not hand over stays queued and is
retried by the serve that owns the project root. The channel is the ONLY way a message enters an agent, so it
arrives in exactly the shape a human prompt does. There is no send-keys fallback, no PTY prompt typing, and no
hook-injected copy — a turn-boundary hook reports freshness and never carries conversation.

Locating the truth in the file is what dissolves the hardest failure this mechanism ever had. Claude's
rendezvous daemon keeps **ONE connection** and destroys the previous socket on every new connect,
discarding any received-but-unparsed line with it — and our own liveness probes ARE such connects, so a
probe landing in the write→parse window silently killed a "successfully sent" prompt (the field incident:
dashboard messages recorded `sent` with no trace in the claude transcript). That single socket write was
the message's only copy, which is why proving it had been parsed needed an in-order barrier, and why a
lost proof needed a resend that might duplicate. With the record written before any transport runs, a lost
kick is not a lost message and a retried one is not a duplicate — the queue entry is removed only by an insert
that landed — so the barrier, its retry classification, and the whole `commit-unknown` outcome — a request
that crossed the transport but whose confirmation was lost — are gone, along with the separate idempotency
ledger that existed to make replay safe. **Acceptance now has exactly two outcomes: the bytes are in the log,
or they are not.**

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

**Merge is a dispatch, not a script.** `mergeSession` carries no `git merge` logic: it reopens the
session (clears the proposal → active, `--resume`s via `reopen` if tmux died — which waits for the
rendezvous socket, closing the just-relaunched-no-socket race), then dispatches a **merge prompt**
through this same `sendText`. The prompt tells the **agent** to merge its branch into the base branch
from the **main checkout** (`-C <main>`, not its node worktree), resolve any conflicts (it knows the
work's intent), and carries the exact reviewed object as authority. Before changing anything, the agent must
re-prove that its worktree top-level, symbolic branch, worktree HEAD, and stored branch ref still name that
reviewed object; detached HEAD, another branch, or a moved/missing ref stops the handoff. After syncing and
re-running its proof, it freezes the tested result as an object id, re-proves the symbolic branch and stored
ref, and merges that exact object rather than the moving branch name. It then verifies the base HEAD advanced
with no merge left in progress, runs `git merge --abort` if anything went half-merged, and proposes close once
verified — so the final generation fence lives at the agent's actual landing boundary, not only in the
server's earlier read, and the base is never left half-merged. Async: `POST
/api/sessions/:id/merge` returns `{dispatched:true}` once the merge prompt is appended (409 only when the
record cannot accept it). The server no longer bumps `merges` on a click.

The public merge dispatch requires `expectedBranchHead` and `expectedBaseHead` from the immediately preceding
manager review together with the standard `Idempotency-Key` header. Missing authority, malformed JSON, unknown
fields, abbreviated/non-native object ids, an ungoverned record, or any lifecycle other than
`awaiting` + `proposal=merge` is refused before reopen, record mutation, timeline append, or queue mutation.
The key is request authority, not transport identity: only a SHA-256 digest bound to the exact session id is
retained on the existing durable sent timeline event, together with the normalized head-pair digest. Under the
same session record lock that validates the record and Git pair and appends the prompt, a replay of the same
session/key/payload returns the original accepted dispatch without appending or enqueueing a second prompt;
reusing that key for a different pair fails loudly with `session_merge_key_reused`.

The first acceptance proves that the recorded worktree still has its governed symbolic branch checked out,
that the stored branch ref and canonical base ref still name the expected objects, and that the worktree HEAD
matches the branch ref. Detached/reassigned worktrees fail with `session_merge_branch_unproven`; either moved
ref fails with `session_merge_head_changed`. Only after the timeline+queue acceptance exists does merge perform
the existing ensure-live operation and drain the debt. A retry after a backend crash therefore replays the
receipt even if that accepted operation already reopened the session. There is no unkeyed bypass and no second
operation ledger: the timeline line is the durable acceptance record and the pending queue remains its only
delivery debt.

**Prompts state the task; the git flow is mechanism, not duplicated prose.** The merge prompt above states
only the **task** plus its own safety steps. It deliberately does **not** re-state the git flow's mechanics,
because each is enforced by a product mechanism, not injected prose: the `node/<id>` branch by [[launch]]'s
`newSession`, the `Session:` trailer by the prepare-commit-msg hook, commit-before-declare by the `core`
system config node materialized into the agent's contract (see [[launch]]), and the `--no-ff` / `merge
node/<id>: <reason>` style by the **merge prompt** at merge time (the one place no other mechanism carries
it). No standing `ritual` config node is needed — the flow is the product default, not a per-project opinion.

**Creating or deleting a spec node is NOT a server op.** It is prompt-driven work the launched agent does
itself — the composer's board chords merely prefill a plain instruction ("create a new node under
`[[parent]]`…" / "delete `[[node]]`…"), and the agent authors or refactors-away the node like any other spec
work. The server never mutates the spec tree; it only launches. [[mentions]] is passive reference grammar,
not a dispatch mechanism. Ordinary `text` input is prompt delivery for every caller, including the Command
Box; a shell `spex session send` and the dashboard therefore share one explicit message operation.

All faces reach the wire as **one route**, `POST /api/sessions/:id/input`, with `kind` the discriminator:
`kind:"text"` is the prompt dispatch above; `kind:"command"` is its Command Box alias with identical
delivery semantics and no mention resolution; `kind:"keys"` is the **raw-key face** (`rawKey`), which keeps its
own `tmux send-keys` transport — the per-keystroke channel for driving the agent's TUI menus, carrying named
keys, printable chars, and `⌃`/`⌥`/`⌘` modifier combos (as `C-`/`M-`/`S-` tokens) so CLI remote control drives the
terminal, **not** a prompt fallback. The transport split (socket vs send-keys) is an implementation fact the
API deliberately does not surface; an unknown `kind` is a loud 400, never a guessed channel. The raw face is
the **last resort** everywhere it is taught (`spex session send <SEL> --keys`):
unstable by nature and able to confirm dangerous dialogs, so callers try a plain text send first.
