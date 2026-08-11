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
  - spec-cli/src/session-manager-authority.api.test.ts
  - spec-cli/src/session-merge-prompt-ascii.api.test.ts
  - spec-cli/src/session-merge-prompt-observability.api.test.ts
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/test/session-toolbar.e2e.mjs
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
server's earlier read, and the base is never left half-merged.

**A gate whose verdict lives only in an exit code is not a gate its executor can read.** Both of those
blocks are handed to an AGENT, and an agent's window renders a silent command as "no output" — while a bare
`&&` chain of `test`s is equally silent when it holds and when it breaks. The two outcomes then arrive
identical, and the only safe reading of an ambiguous gate is the pessimistic one, so a branch sitting in
exactly its reviewed generation is refused as a stale review, permanently, by a correct agent. That is not
an agent bug: a prompt that asks for a decision must hand over something to decide on. So each block
**carries its own verdict**. It prints ONE success token — `REVIEWED_GENERATION_OK` for the generation
re-proof, `LANDING_MERGED <oid>` for the landing — and the prompt states the rule beside it: seeing that
token is the only pass, and absent output is a fail, not an unknown. Failure is diagnosable in the same
breath, because each item reports its own actual-vs-expected value under a stable `<n>/<item>` label
(`1/toplevel`, `2/symbolic`, `3/wtHEAD`, `4/mainref`, `5/baseref`; `1/symbolic`, `2/mainref`, `3/ancestor`),
so a genuine stale review says WHICH generation moved instead of refusing blank. None of this loosens the
gate: the verdict line still conjoins every check, and the merge still runs only inside that conjunction.

**The block is also 7-bit ASCII, because the trip to the executor is not a byte-transparent channel.** It
crosses the control channel, the agent's own tool call, and a terminal before a shell parses it, and such a
hop can drop a byte above 0x7F, substitute U+FFFD for it, or stop the text at the first one. A gate that
compares unicode ref and path bytes as shell strings holds only if every hop carried them intact — and on the
fleet one did not, refusing a branch that was exactly its reviewed generation. Every session slug here is
derived from the human's own words, so a unicode branch is the ordinary case, not an edge one. Which hop lost
the byte is not recoverable from the refusal and does not need to be: instead, NO comparison in the block
depends on a byte above 0x7F surviving. The two values that carry arbitrary text — the worktree top-level and
the symbolic ref, taken in its full `refs/heads/…` form rather than the shortened one — are compared as hex
read straight off git's pipe, before any shell string layer touches them; object ids are ASCII by
construction and stay plain; and the path and ref the commands need as ARGUMENTS are materialised from POSIX
`printf %b` octal escapes. A pure-ASCII value is emitted as the ordinary quoted literal, so a project without
unicode names sees the prompt it always saw. What the block prints is ASCII as well, so a failing item's
actual value stays readable through a lossy display — the field report that opened this could only say
`node/<?>`.

Two premises hold that up and belong here rather than in a guess about them. **The expected side is derived
from raw bytes** — the filesystem's own bytes for the worktree path — and never from a normalized or
re-encoded string: a normalization applied to both sides would agree with itself and hide exactly the fault
it was meant to catch. And **git is not the fragile part**: `rev-parse --show-toplevel` and `symbolic-ref`
emit their bytes raw, `core.quotePath` governing neither, measured identical across shells and locales. The
repair does not ask git to change; it stops requiring a byte-transparent path to the shell. Async: `POST
/api/sessions/:id/merge` returns `{dispatched:true}` once the merge prompt is appended (409 only when the
record cannot accept it). The server no longer bumps `merges` on a click.

The public merge dispatch requires `expectedBranchHead`, `expectedBaseHead`, and `expectedReviewEpoch` from the
immediately preceding manager review together with the standard `Idempotency-Key` header. The epoch is the durable
generation of the agent's `awaiting` + `proposal=merge` declaration: every explicit renewed merge declaration
advances it, even when its visible declaration and Git heads are unchanged. Missing authority, malformed JSON,
unknown fields, abbreviated/non-native object ids, a non-integer/negative epoch, an ungoverned record, or any lifecycle other than
`awaiting` + `proposal=merge` is refused before reopen, record mutation, timeline append, or queue mutation. A
full-length expected id that is absent or is not a commit is likewise a structured `session_merge_head_changed`
conflict, never an internal error from prompt-subject lookup.
The key is request authority scoped to the exact `/api/sessions/:id/merge` route, not global transport identity:
only its SHA-256 digest is retained on that session's existing durable sent timeline event, together with the
normalized head-pair-and-review-epoch digest. Under the same session record lock that validates the record,
declaration epoch, and Git pair and appends
the prompt, a replay of the same session/key/payload returns the original accepted dispatch without appending or
enqueueing a second prompt; reusing that key for a different pair or review epoch on the same session fails loudly with
`session_merge_key_reused`. Another session may independently accept the same raw key because its timeline is a
separate authority domain; callers coordinating a successor persist a key derived from that successor id, pair,
and review epoch. The first accepted declaration's settled receipt stays response-only on its same-key replay
even after a later refresh, while the refreshed epoch/key is a distinct authorized prompt and delivery.
The receipt also carries the exact private transport text. A crash after receipt append but before queue publication
is recoverable from that one durable event: same-key replay restores the missing `mid` debt under the existing queue
lock and drains it once. Initial publication and every recovery use the same keyed pending shape: exact `mid`, frozen
transport text/sender, operation, and request digest. Successful adapter handover appends a private settlement event
before removing the debt. A process dying in that second gap leaves both settlement and pending; the next drain
recognizes only an exact receipt/mid/transport match and consumes it without another adapter call. A missing or
mismatched receipt is a refusal and stays owed. Once settled, replay returns the recorded acceptance without touching lifecycle or queue state — later active,
stopped, or archived state is authoritative and is never reopened merely to replay a response. Old receipts without
this recovery form retain their historical response-only replay semantics.

The first acceptance proves that the recorded review epoch still names the declared merge generation, that the
recorded worktree still has its governed symbolic branch checked out, that the stored branch ref and canonical
base ref still name the expected objects, and that the worktree HEAD matches the branch ref. A refreshed
declaration makes a fresh key carrying the new epoch necessary; a fresh key carrying an older epoch fails
`session_merge_review_changed`. Detached/reassigned worktrees fail with `session_merge_branch_unproven`; either moved
ref fails with `session_merge_head_changed`. Only after the recoverable timeline acceptance exists does merge perform
the existing ensure-live operation and drain the debt. There is no unkeyed bypass and no second operation ledger:
the timeline records acceptance and settlement, while the pending queue remains the only live delivery debt.

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
