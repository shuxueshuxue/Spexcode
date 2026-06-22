---
title: dispatch
status: active
hue: 280
desc: Deliver a prompt to a live agent over its rendezvous socket — socket-only, fail-loud — plus the merge intent.
code:
  - spec-cli/src/sessions.ts
---

# dispatch

## raw source

Dispatching a **prompt** to a session — a message, a continue, the merge instruction, a node directive —
is **control**, separate from the tmux pane, which is **display only**. Control must be **scoped** (only
sessions this product launched) and **fail-loud** (a dead dispatch is seen, never silently degraded to
typing into the pane). And **merge is an intent the human expresses, not a server-run git script.** A
dispatched prompt states only the **task**; the git flow's mechanics are carried by product **mechanism**,
not restated in every prompt, so the prompt and the flow never duplicate.

## expanded spec

Prompt control goes through a **per-session rendezvous socket only**, never PTY keystrokes. The socket
path is **derived from the session id** (set up at [[launch]]), so only our own sockets are addressed —
control never reaches a Claude Code session outside the product. Writing one `{"type":"reply","text":…}`
line injects the text and submits it deterministically, so multi-line prompts and Enters can't be
corrupted the way `tmux send-keys` could.

`sendKeys` is **socket-only with no send-keys fallback** and confirms the agent actually **accepted** the
prompt, not mere write-success. The daemon acks no accepted reply, so acceptance is an **in-order
round-trip**: it writes the `reply` line then a `repaint` line; the daemon handles lines strictly in order,
so a `repaint-done` with no preceding `reply-rejected` proves the reply was taken (`repaint` is auth-exempt,
a reliable probe even if a future daemon gates `reply`). A missing/socketless session, a connect error, a
`reply-rejected`/`shutting-down`, or a timeout all return a **loud `DispatchResult {ok,error}`** that
propagates: `POST …/keys` answers **502**, `spex session send` prints it, `mergeSession` returns it.

**Merge is a dispatch, not a script.** `mergeSession` carries no `git merge` logic: it reopens the
session (clears the proposal → active, `--resume`s via `reopen` if tmux died — which waits for the
rendezvous socket, closing the just-relaunched-no-socket race), then dispatches a **merge prompt**
through this same `sendKeys`. The prompt tells the **agent** to merge its branch into the base branch
from the **main checkout** (`-C <main>`, not its node worktree), resolve any conflicts (it knows the
work's intent), verify the base HEAD advanced with no merge left in progress, `git merge --abort` if
anything went half-merged, and propose close once verified — so the guarantee lives in the agent's
verification, never a server check, and the base is never left half-merged. Async: `POST
/api/sessions/:id/merge` returns `{dispatched:true}` once the prompt is **confirmed accepted** (409 if
unreachable). The server no longer bumps `merges` on a click.

**Prompts state the task; the git flow is mechanism, not duplicated prose.** Every prompt the server builds
— the merge prompt above and the directive **new-node** / **delete-node** prompts (each a placeholder the
server set up, handed to the agent to name+spec+code or refactor-away by git history) — states only the
**task** plus its own safety steps. It deliberately does **not** re-state the git flow's mechanics, because
each is enforced by a product mechanism, not injected prose: the `node/<id>` branch by [[launch]]'s
`newSession`, the `Session:` trailer by the prepare-commit-msg hook, commit-before-declare by the `core`
system config node folded into the gathered system prompt (see [[launch]]), and the `--no-ff` / `merge
node/<id>: <reason>` style by the **merge prompt** at merge time (the one place no other mechanism carries
it). No standing `ritual` config node is needed — the flow is the product default, not a per-project
opinion. The one task-level detail the directive prompts keep is "propose merge, don't merge".

The **separate raw nav-key channel** (`rawKey`) keeps its own `tmux send-keys` path — the single-keystroke
channel for driving the agent's TUI menus, **not** a prompt fallback.
