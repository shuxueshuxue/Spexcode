---
title: runtime
status: active
hue: 280
desc: The per-session GLOBAL store dir — every harness-written runtime artifact under ~/.spexcode, keyed by session_id and grouped per-project, so the worktree stays 100% clean.
related:
  - spec-cli/src/layout.ts
  - spec-cli/src/sessions.ts
---

# runtime

## raw source

A session has runtime bookkeeping the harness scribbles for it — the lifecycle record, the originating
prompt, a queued session's launch prompt, the launch script, the recorded inter-agent comms. None of it is
the agent's spec/code work, and putting any of it in the worktree was the
root of two problems: it polluted the tree the agent commits, and it forced a 1:1 worktree↔session identity
(a path key), so two agents in one folder would clobber. So the runtime lives OUTSIDE the worktree entirely,
in a per-user GLOBAL store keyed by SpexCode's governed **`session_id`** — the worktree is left pristine
(zero SpexCode files), and each agent gets its own record even when several share a folder. Claude Code's
harness id equals that governed id; Codex mints its own thread id, so the backend stores that separately as
`harness_session_id` when `codex-launch` completes `thread/start` for the worktree.

## expanded spec

The store mirrors Claude's `~/.claude/projects/<enc>/` shape: a per-session dir at

```
<SPEXCODE_HOME or ~/.spexcode>/projects/<enc(project-root)>/sessions/<session_id>/
```

`<enc>` encodes the **project root** with Claude's scheme (path separators → `-`); the project root is the
MAIN checkout — `dirname` of the shared git **common** dir — which resolves identically from main or any linked
worktree, so the board (at main) and a hook (in a worktree) land on the same dir. Every per-session artifact is
a file in that dir:

| file | written by |
|---|---|
| `session.json` | `readRecord` / `writeRecord` — the structured lifecycle record ([[state]]): state, governed, worktree_path, node, branch, createdAt, harness_session_id, … |
| `prompt` | the originating human ask ([[launch]]) |
| `launch` | the deferred launch prompt of a still-queued session ([[launch]]) |
| `launch.sh` | the whole launch invocation (`launchScript`, run via `bash <abs path>`) |
| `spec-checked` / `spec-of-file-seen` | the [[spec-first]] / [[spec-of-file]] once-per-session sentinel + ledger |
| `comms.ndjson` | recorded inter-agent talk ([[comms-edge]]) |

`layout.ts` owns the seam — the one place that knows where the store sits: `spexcodeHome()` (the `SPEXCODE_HOME`
override → `~/.spexcode`), `encodeProject()` / `projectKey()`, `runtimeRoot()` (the per-PROJECT tier:
`projects/<enc>`), `sessionsRoot()` (its `sessions/` child — the board's enumeration dir), `sessionStoreDir(id)`,
`sessionRecordPath(id)`, `sessionArtifactPath(id, name)`, plus `readRawRecord` / `listSessionIds` for the board.
The store has TWO tiers under one per-project dir: the per-session dirs above, AND the per-TREE render
slots — `trees/<enc(worktree-toplevel)>/` — that [[hook-dispatch]] / [[harness-delivery]] render into.
Each slot holds the artifacts that are a pure function of THAT tree's `.config` (the hook manifest, the
content-hash freshness stamp, the plugin-folder ledger), keyed by the same `encodeProject` transform
applied to the worktree's `rev-parse --show-toplevel` — the sessions pattern (shared global root, slotted
by identity) applied to trees, so two worktrees with divergent `.config` never trade hook sets. The
project tier also carries the Codex app-server socket/pid/log/lock when Codex is launched through
SpexCode. All of it lives under `runtimeRoot()`, NOT the worktree. So the worktree holds ZERO
SpexCode-rendered runtime; the only in-tree artifacts are the harness-discovered contract files (CLAUDE.md/
AGENTS.md block) + shims, which MUST sit in-tree for the harness to find them. `sessions.ts` writes through `storeDir(id)` (mkdir-and-return) and the full typed
`readRecord` / `writeRecord`; the shell hooks reimplement the SAME path scheme in bash (the one cross-language
mirror — a change to the seam must update both, noted at the layout.ts helpers). Because the only in-tree
SpexCode artifacts are gitignored (the materialize shims/skills) or tracked-and-committed (the contract block
in CLAUDE.md/AGENTS.md), none shows as an uncommitted change, so the Stop-gate's dirty count needs no runtime
filtering, and `session.json` is written one-field-per-line with every key present so the hot-path hook edits
it with sed, not jq ([[state]]).

`session.json` writes are by canonical governed `session_id`, never by cwd. Claude's harness id equals that
record id. Codex hook payloads and spawned commands carry the acting thread id, while the shared app-server env
may carry a stale `SPEXCODE_SESSION_ID`; those Codex ids are resolved through `harness_session_id` before a
governed record is written. Self-launched agents with no governed record may still get raw-id sentinel dirs for
spec-discipline hooks, but board lifecycle hooks no-op without `governed:true`. `close` removes the worktree,
sweeps the whole per-session store dir AND that worktree's `trees/` render slot (computed before the
removal — the slot key needs the live tree); `exit` keeps all of them, so an offline session is still on
the board and `--resume`-able. Codex's project app-server is not swept by closing one session because several Codex sessions
and several `spexcode serve` processes in the same project may be using the same control plane; routing is by
`harness_session_id`, not by socket ownership.

This is a CLEAN cut from the old per-worktree `.session/` layout — there is no compat shim. An in-flight session
launched under the old backend keeps its worktree `.session/` until it drains; the new backend simply doesn't
read it (those sessions relaunch into the global store). The old `.gitignore` entries for `.session*` are inert
and may be dropped.
