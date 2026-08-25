---
title: hook-shell-mirror
status: active
hue: 280
desc: The shell mirror of the harness adapter — `hooks/harness.sh` owns the harness-divergent payload parse (touched paths, quoted fields, the ask capture, the in-process subagent stamp) and thread-id → record alias resolution for every pure-shell hook handler.
code:
  - spec-cli/hooks/harness.sh
related:
  - spec-cli/hooks/dispatch.sh
  - spec-cli/src/harness.ts
  - spec-cli/src/harness.test.ts
---

# hook-shell-mirror

The hook handlers are pure shell and cannot import `harness.ts`, so [[harness-adapter]]'s payload facts have a
second, mirrored home: `hooks/harness.sh`, sourced by every handler and exported by `dispatch.sh`. It owns exactly
the divergences a handler must read from a hook's stdin — never a lifecycle decision — and every handler consumes
its helpers instead of parsing JSON of its own.

A Codex hook payload carries `session_id` (uuid), `turn_id`, `transcript_path`, `cwd`, `hook_event_name`
(CamelCase, e.g. `PreToolUse`), `model`, `permission_mode`, `tool_name`, `tool_input`, `tool_use_id`, and
`prompt` — measured against a real codex 0.142.3, and snake_case is only the trust-hash key format.
Codex has NO `file_path`; the touched file lives inside `tool_input.command`, and the tool that carries it
differs by operation: an **edit is its own first-class tool `tool_name:"apply_patch"`** whose command is the
**bare patch envelope** (`*** Update File: <path>` lines, with NO literal `apply_patch` token), while a **read/
shell is `tool_name:"Bash"`** + `tool_input.command`. So `hp_code_path` accepts BOTH tools and `_hp_codex_cmd_path`
detects a mutation by the `*** … File:` markers themselves (not by an `apply_patch` token), else takes the last
path-like token (`sed -n 1p f.ts` → `f.ts`). A patch can bundle SEVERAL `*** … File:` markers (a multi-file
edit), so `hp_code_path` emits ALL touched paths — one per line — and every consuming hook iterates them.
Its operation mode is the semantic matcher shared by every harness: `read` accepts only read-shaped payloads,
`mutate` only edits, and `access` their union. The native shims still bind the common `PreToolUse` event
broadly; a non-matching payload simply resolves to no path. [[inject-spec-first]] uses `read`, then advances
only if the spec graph resolves a real governor; [[inject-spec-of-file]] uses `mutate`. Neither hook branches
on a harness or on special filenames. The shared
`hp_field` reads a top-level JSON string value as a real JSON string: the close quote is the first UNESCAPED `"`,
so a `command` carrying a quoted literal (`sed -n "1,5p" f.ts`) is captured whole, not truncated at the inner
quote. `hp_is_ask` maps Codex's `request_user_input` (and Claude's `AskUserQuestion`) onto the question capture. `hp_is_subagent`
reads the acting-agent discriminator: a Claude IN-PROCESS subagent (Task tool) fires the parent's hooks with the
PARENT's `session_id`/`transcript_path` but a top-level `agent_id` (+ `agent_type`) stamp the parent's own calls never
carry (measured live, claude 2.1.207 — the payload-id rule above cannot separate them, this stamp can). The scan is
structural: only the pre-`tool_input` payload prefix is searched for the `"agent_id":` key shape — every string value's
quotes arrive JSON-escaped and an agent_id-NAMED tool parameter sits inside `tool_input`, past the truncation — so the
answer is deterministic, never a content heuristic. Codex payloads carry no such field (its verified field set below), so
the probe never matches there; mark-active consumes it to keep a supervising parent's declared state out of its
subagents' reach (the stop-gate race).
So [[inject-spec-first]], [[inject-spec-of-file]], and mark-active fire on Codex, not just Claude — the shared shim lives at
the main checkout, but its commands run `dispatch.sh` with the thread cwd as `proj`, so each worktree gates
against its own tree even though one project-scoped server (and one shared shim) drives them all. The session-id +
global-store resolution every handler repeated is folded into the same helper (`hp_session_id`, `hp_store_dir`).
There is NO codex thread-id capture hook: the backend OWNS the thread id (it `thread/start`s the thread at
launch and stages the proven id for the lifecycle owner to store as `harness_session_id` — see above), so no dispatcher or lifecycle hook branches on
Codex and Claude needs nothing here either (its pinned id already is the record id). But design C's hooks fire
from the SHARED per-project app-server process, whose env can inherit the FIRST session's baked
`SPEXCODE_SESSION_ID`, so a governed codex hook must NOT trust that env var. On codex, `hp_session_id` resolves
from the hook payload's `session_id` — the acting codex THREAD id — and id→record resolution carries an ALIAS
step: when no record sits at the id directly, find the one record that captured this id as `harness_session_id`
(a `grep` over the few runtime.json files on the shell hot path — no jq; the typed TS read mirrors it in
`readAliasedRawRecord`). This is what lets the pure-shell `mark-active` re-flip and the ask-capture, plus every
shell hook lifecycle write, reach the right record from a thread id even when the app-server env is contaminated.
The alias needs no cleanup artifact — it lives in the record's own `harness_session_id`, swept with the record on
close. Claude is unaffected on this path: its exported `CLAUDE_CODE_SESSION_ID` equals both its payload id and
the record key, so the direct hit always wins and the alias step never runs.
