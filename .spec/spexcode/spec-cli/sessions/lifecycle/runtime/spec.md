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
prompt, a queued session's launch prompt, the generated hook settings, the launch script, the isolated
project `CLAUDE.md`. None of it is the agent's spec/code work, and putting any of it in the worktree was the
root of two problems: it polluted the tree the agent commits, and it forced a 1:1 worktree↔session identity
(a path key), so two agents in one folder would clobber. So the runtime lives OUTSIDE the worktree entirely,
in a per-user GLOBAL store keyed by the harness **`session_id`** — the worktree is left pristine (zero
SpexCode files), and each agent gets its own record even when several share a folder.

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
| `session.json` | `readRecord` / `writeRecord` — the structured lifecycle record ([[state]]): state, governed, worktree_path, node, branch, createdAt, … |
| `prompt` | the originating human ask ([[launch]]) |
| `launch` | the deferred launch prompt of a still-queued session ([[launch]]) |
| `hooks.json` | the per-session Claude Code hooks (`writeSettings`, referenced by `--settings`) |
| `launch.sh` | the whole launch invocation (`launchScript`, run via `bash <abs path>`) |
| `claude.md` | the moved project `CLAUDE.md` ([[launch]]'s isolation — out of the worktree, so auto-discovery never sees it) |
| `spec-checked` / `spec-of-file-seen` | the [[spec-first]] / [[spec-of-file]] once-per-session sentinel + ledger |
| `comms.ndjson` | recorded inter-agent talk ([[comms-edge]]) |

`layout.ts` owns the seam — the one place that knows where the store sits: `spexcodeHome()` (the `SPEXCODE_HOME`
override → `~/.spexcode`), `encodeProject()` / `projectKey()`, `sessionsRoot()` (the board's enumeration dir),
`sessionStoreDir(id)`, `sessionRecordPath(id)`, `sessionArtifactPath(id, name)`, plus `readRawRecord` /
`listSessionIds` for the board. `sessions.ts` writes through `storeDir(id)` (mkdir-and-return) and the full typed
`readRecord` / `writeRecord`; the shell hooks reimplement the SAME path scheme in bash (the one cross-language
mirror — a change to the seam must update both, noted at the layout.ts helpers). Because no SpexCode file is in
the worktree any more, the Stop-gate's dirty count needs no runtime filtering, and `session.json` is written
one-field-per-line with every key present so the hot-path hook edits it with sed, not jq ([[state]]).

`session.json` writes are by `session_id` (the agent/hook resolves its own id from the harness env var or the
payload), so they never depend on cwd beyond the project key. `close` removes the worktree AND sweeps the whole
store dir; `exit` keeps both, so an offline session is still on the board and `--resume`-able.

This is a CLEAN cut from the old per-worktree `.session/` layout — there is no compat shim. An in-flight session
launched under the old backend keeps its worktree `.session/` until it drains; the new backend simply doesn't
read it (those sessions relaunch into the global store). The old `.gitignore` entries for `.session*` are inert
and may be dropped.
