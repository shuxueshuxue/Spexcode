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

Dispatching a **prompt** to a session — a message, a continue, the merge instruction — is **control**,
separate from the tmux pane, which is **display only**. Control must be **scoped** (only sessions this
product launched) and **fail-loud** (a dead dispatch is seen, never silently degraded to typing into the
pane). And **merge is an intent the human expresses, not a server-run git script.**

## expanded spec

Prompt control goes through a **per-session rendezvous socket only**, never PTY keystrokes. The socket
path is **derived from the session id** (set up at [[launch]]), so only our own sockets are addressed —
control never reaches a Claude Code session outside the product. Writing one line
`{"type":"reply","text":…}` injects the text as a prompt and submits it deterministically, so multi-line
prompts and Enters can't be corrupted the way `tmux send-keys` could.

`sendKeys` is **socket-only with no send-keys fallback** and confirms the agent actually **accepted** the
prompt, not mere write-success. The daemon acks no accepted reply, so acceptance is an **in-order
round-trip**: `sendKeys` writes the `reply` line immediately followed by a `repaint` line; the daemon
dispatches lines strictly in order, so a `repaint-done` with no preceding `reply-rejected` proves the
reply was taken (`repaint` is auth-exempt, a reliable probe even if a future daemon gates `reply`). A
missing/socketless session, a connect error, a `reply-rejected`/`shutting-down`, or a timeout all return
a **loud `DispatchResult {ok,error}`** that propagates: `POST …/keys` answers **502** (not 200), `spex
session send` prints the reason, and `mergeSession` returns it.

**Merge is a dispatch, not a script.** `mergeSession` carries no `git merge` logic: it reopens the
session (clears the proposal → active, `--resume`s via `reopen` if tmux died — which waits for the
rendezvous socket, closing the just-relaunched-no-socket race), then dispatches a **merge prompt**
through this same `sendKeys`. The prompt tells the **agent** to merge its branch into main, resolve any
conflicts (it knows the work's intent), verify main's HEAD advanced and no merge is left in progress,
`git merge --abort` if anything went half-merged, and propose close once verified — so the guarantee
lives in the agent's verification, never a server check, and main is never left half-merged. The action
is async: `POST /api/sessions/:id/merge` returns 200 `{dispatched:true}` once the prompt is **confirmed
accepted** (409 if unreachable). The server no longer bumps `merges` on a click.

The **separate raw nav-key channel** (`rawKey`) keeps its own `tmux send-keys` path — the interactive
single-keystroke channel for driving the agent's TUI menus, **not** a prompt fallback — left untouched.
