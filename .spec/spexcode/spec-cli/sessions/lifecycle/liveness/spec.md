---
title: liveness
status: active
hue: 280
desc: Whether a session's agent is addressable — derived for every session by two probe tiers and a tri-state listener test, with `unknown` for a probe that could not tell and `offline` only for a corpse two witnesses agree on.
code:
  - spec-cli/src/sessions.ts#liveness
related:
  - spec-cli/src/harness.ts
  - spec-cli/src/host-resources.ts
  - spec-cli/src/commit-gate.test.ts
---

# liveness

Liveness is the runtime-derived axis of [[state]]: it never overrides the lifecycle the agent authored, and it is
the reading a supervisor ACTS on — `offline` disarms the relaunch guard — so this node's whole contract is that
the reading is honest before it is fast. Each adapter supplies its own probe ([[harness-adapter]]); the tiers,
the witnesses, and the failure rule below are shared.

**Derivation.** Most interactive adapters derive that answer from process/transport probes. Headless adapters deliberately
  derive it from their runtime owner: a Claude-headless or other leaf-backed controller is online only when its
  registered controller process is alive (the tmux pane or its fallback shell is not the session), while Codex-headless
  joins the shared app-server proof with the exact thread's loaded-reference census. Turn children are ephemeral,
  so no resident turn process is an idle state rather than death; controller faults fail loudly at delivery. A human `stop` is
  authoritative rather than a probe: it stamps the retained record's `stopped` liveness metadata after tearing
  down the runtime, so even a failed tmux probe cannot turn that known stop into `unknown`. For the process-probed adapters,
  detection runs in **two tiers, never the pane's foreground command**. The **hot 100ms tier** is a zero-spawn
  death detector: launch registers the agent's real pid (`agent.pid`, stamped pre-`exec` so it IS the agent's
  own pid), and one `kill(pid,0)` syscall reads it — an ESRCH death is **latched per (pid, mtime)** (the
  pid-reuse guard; only a relaunch's fresh write resets it), so a thrashed loop can't hang it. The **warm 1s
  tier** is one bounded tmux snapshot plus the rendezvous probe: Claude requires a **live
  LISTENER on its rendezvous socket** — a `connect()` the running agent accepts, **not** the socket FILE merely
  existing (a crashed claude leaves its socket path on disk; a file check read a DEAD pane `online` indefinitely
  — it must read `offline` within seconds). Codex reads the hot tier's `agent.pid`; its old whole-box `ps`
  descendant walk is **demoted to a self-extinguishing legacy fallback** for a pre-registration session with no
  `agent.pid`. For every interactive adapter, the session-owned pane/leaf remains a necessary online witness:
  stale record fields or a thread still addressable through a project-shared control plane cannot make a row
  with no target pane and no target leaf read `online`/`working`; it converges to `offline`.

  **Board honesty under load — the probe can fail, and a failed probe is not a death.** The tmux snapshot is
  one bounded call; under heavy load it can time out — a timed-out probe means we **cannot tell** who is alive,
  categorically different from "tmux is up and this session is gone," so those rows yield `unknown`, rendered
  **probe-failed**, never `offline`/`closed`, and the row **never vanishes** (enumerated from the durable
  store). Its three pane fields are separated by a **printable** boundary that the format asks for and the parser
  splits on as ONE constant, because tmux itself rewrites control characters in a format string on the way out
  (a tab and a raw `0x1f` both become `_` on 3.6a; a raw `0x1f` becomes the printable escape `\037` on 3.4). A
  separator that survives one version and not the next is worse than a wrong reading on one row: no session is
  seen to own a window at all, so every live agent's row degrades to `unknown` at once.
  The **listener probe is tri-state for the same reason**:
  only a completed connect (`live`) or an instant refusal/absence (`ECONNREFUSED` off a stale socket file /
  `ENOENT` — proven `dead`) settle the question; a connect **timeout** (a thrashed loop fires the timer before
  the pending connect) or **EAGAIN** (a full backlog — a listener alive-but-busy) are `unproven`, read
  `unknown`, never `offline`. The board bounds concurrent listener connects so its own probe burst does not fill
  healthy listeners' backlogs. This is the honesty rule the mass-restore incident violated (a slow box read as a
  graveyard, live workers relaunched to death) and the false-`offline` wait verdict (issue #40) too. Fail loud
  (`unknown`), never guess (`offline`). The same rule reaches one layer further down, because a settled `dead`
  answers only about the TRANSPORT: a socket path can be unlinked out from under its own live listener — by a
  stray `rm`, or by any teardown that believes it owns the path — after which every connect `ENOENT`s (proven
  dead) while the agent keeps working, merely unreachable. So the transport is not the only witness:
  the launch-registered `agent.pid` is a second, independent one, and while it still answers, death stays
  UNPROVEN → `unknown`. Only a corpse both witnesses agree on is `offline`, because `offline` is the reading
  a supervisor ACTS on — it is what disarms the relaunch guard, and relaunching a working agent kills it.
