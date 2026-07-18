---
title: shim-runtime
status: active
hue: 285
desc: The ONE shared runtime embedded into every generative per-session shim (pi's extension, opencode's plugin) — claude-shaped dispatch, the single block-verdict contract (exit 2 + stdout decision:block JSON), and the multi-connection rendezvous server. A new harness generator declares only its event mapping and host API bindings.
code:
  - spec-cli/src/shim-runtime.ts
related:
  - spec-cli/src/pi-harness.ts
  - spec-cli/src/opencode.ts
  - spec-cli/hooks/dispatch.sh
---

# shim-runtime

Some harnesses have no external hook binding: their shim is GENERATED code running inside the agent process
(pi's extension, opencode's plugin — [[pi-harness]], [[opencode-harness]]). The first two generators each
hand-wrote the same machinery, and the divergence cost was measured, not hypothetical: the deliver
delivery-confirm bug was fixed only in opencode's copy, the dropped stop-gate rejection only in pi's. This
node is the cure: ONE embedded runtime source every generative shim composes, so a generator declares nothing
but its event-name mapping and its host API bindings — the socket protocol and the verdict parse are never
rewritten. That is the acceptance test for any future harness of this kind.

The runtime owns five shared contracts:

- **dispatch** — synthesize the claude-shaped payload (`session_id`, `cwd`, `hook_event_name`, extras) and
  pipe it to `dispatch.sh <harnessId> <Event>`, the id baked as argv[1] (the shell-side detector), returning
  the exit code plus both streams. Hosts keep ordering tool payloads so `agent_id` precedes `tool_input`
  (the harness.sh prefix-scan contract).
- **the ONE block verdict** — blocked = exit 2, nothing else. The reason is read in contract order: a strict
  decision:block JSON line on stdout (the designed channel), then a regex over GLUED handler outputs
  (several handlers' stdout concatenates without separators), then stderr (a bare exit-2 handler), then the
  caller's fallback — always the parsed human-readable reason, never the escaped wire JSON. codex's stderr
  bridge is codex's own native protocol and stays in dispatch.sh, untouched here.
- **the rendezvous server** — binds the launch-injected rendezvous socket and speaks the reclaude
  mini-protocol, so claude's deliver and socket-listener liveness are reused verbatim. MULTI-connection
  (unlike reclaude's daemon): a board probe connect can never kick a concurrent delivery. Confirmation means
  PARSED, synchronously — repaint-done flushes before any injection (a whole model turn on some hosts) runs;
  a known-unable inject answers reply-rejected before that barrier so the sender fails loud instead of
  confirming an undeliverable prompt.
- **the stop-gate loop closure** (`dispatchStop`) — a blocked Stop's continuation is a LOOP, and the loop
  needs a termination bit: claude's native Stop payload carries `stop_hook_active=true` inside a
  hook-forced continuation, and the stop-gate's escape paths (auto-declare / downgrade-to-ask) key on
  exactly that bit to guarantee the loop ends. A generative host has no native bit, so the runtime supplies
  it — false on a natural stop, true on the settle that follows a blocked one, reset by the first allowed
  stop — and on block re-enters the gate's parsed reason through the host's inject. Without the bit every
  settle reads as a FIRST stop, a gate that can never pass (the commit gate on a 0-commit worktree) blocks
  forever, and the loop ends only when the host process dies — the measured one-shot wedge: pi's print
  mode disposes its session while the loop still runs, the next inject throws "extension ctx is stale"
  into the host, the rejection is dropped, and the record wedges `active` (rc=97 through both recovery
  turns). So an inject the host can no longer take is caught LOUD on stderr, never thrown into the host
  and never silent — the out-of-process one-shot recovery ([[harness-adapter]]) is the layer that survives
  the process.
- **tool-input normalization** — the host's file-path spelling (pi `path`, opencode `filePath`) is moved
  onto claude's `file_path`, the key every claude-family handler reads.

The chunk is plain untyped ESM over node builtins — the lowest common denominator of pi's native-.ts loader,
opencode's plugin loader, and a bare node import in tests — and is embedded VERBATIM by each generator: the
generated file stays self-contained (nothing to resolve from a worktree at run time), and a materialize
refreshes every clone from this one source.
