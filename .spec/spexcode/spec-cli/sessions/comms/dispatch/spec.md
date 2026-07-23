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

`sendText` has **no send-keys fallback** and asks the resolved adapter to confirm at the strongest layer its
native channel exposes. Interactive Claude confirms the prompt was **parsed by the daemon**, not merely written.
Mere write-success lies there, because claude's rendezvous daemon keeps **ONE connection** and
destroys the previous socket on every new connect — discarding any received-but-unparsed line with it — and
our own liveness probes ARE such connects, so a probe landing in the write→parse window silently killed a
"successfully sent" prompt (the field incident: dashboard messages recorded `sent` with no trace in the
claude transcript). So delivery writes the `reply` line and a `repaint` probe line as **one atomic chunk**
(the daemon parses a chunk's lines in one synchronous loop, so a kick can only lose both or neither), then
reads its own connection: `repaint-done` **proves the reply was parsed** (in-order barrier); the connection
**closing before it** proves the chunk was never parsed (kicked) → **reconnect and resend**, bounded retries;
the **wall expiring with the connection still open** means a busy event loop is delaying, not losing → report
ok optimistically, never a false failure on a live-but-busy agent. Before any write, the pane is consulted:
claude's **sessions panel** ("← for agents") swallows parsed replies without a trace (enqueued, never
dequeued, daemon silent), so a send into that pane state is **refused loudly** with the recovery named
(press Enter in the terminal to return), never absorbed. A missing/socketless session, a connect error, a
`reply-rejected`/`shutting-down`, or exhausted kick-retries all return a **loud `DispatchResult {ok,error}`**
that propagates: `POST …/input` answers **502**, `spex session send` prints it, `mergeSession` returns it.

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
work's intent), verify the base HEAD advanced with no merge left in progress, `git merge --abort` if
anything went half-merged, and propose close once verified — so the guarantee lives in the agent's
verification, never a server check, and the base is never left half-merged. Async: `POST
/api/sessions/:id/merge` returns `{dispatched:true}` once the prompt is **confirmed accepted** (409 if
unreachable). The server no longer bumps `merges` on a click.

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
work. The server never mutates the spec tree; it only launches. This holds [[mentions]]'s line: outside the
issue store, a reference expands to prompt text, never a programmatic flow — the issue store is the sole
surface where the system itself dispatches.

Both faces reach the wire as **one route**, `POST /api/sessions/:id/input`, with `kind` the discriminator:
`kind:"text"` is the prompt dispatch above; `kind:"keys"` is the **raw-key face** (`rawKey`), which keeps its
own `tmux send-keys` transport — the per-keystroke channel for driving the agent's TUI menus, carrying named
keys, printable chars, and `⌃`/`⌥`/`⌘` modifier combos (as `C-`/`M-`/`S-` tokens) so CLI remote control drives the
terminal, **not** a prompt fallback. The transport split (socket vs send-keys) is an implementation fact the
API deliberately does not surface; an unknown `kind` is a loud 400, never a guessed channel. The raw face is
the **last resort** everywhere it is taught (`spex session send <SEL> --keys`):
unstable by nature and able to confirm dangerous dialogs, so callers try a plain text send first.
