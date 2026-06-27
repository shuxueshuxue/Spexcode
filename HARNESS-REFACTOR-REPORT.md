# Harness-agnostic hook/prompt convergence — corrected design, equivalence proof, scenarios

Status: WORKING DOC (becomes the final report). Branch `node/Codex-93fd`.
Goal (user): converge launch-time prompt+hook injection onto a universal, spec-governed,
harness-agnostic mechanism so an agent launched WITHOUT the dashboard, on Claude Code OR Codex,
gets the same hooks and contract via committed `.claude`/`.codex` files — AND prove the Claude
path stays behaviorally **equivalent** to today.

This doc is rewritten in place. It carries: (§1) what the official docs CORRECTED in the plan,
(§2) the corrected architecture, (§3) the equivalence proof, (§4) the scenario suite, (§5) the
honest list of compromises (each pushed to its limit first).

---

## §1. Doc-driven plan corrections (every claim sourced from official docs, read 2026-06-27)

The plan from the design turns had assumptions the docs REFUTED. Recording them so the build honors reality, not the earlier guesses.

### 1.1 System prompt CANNOT move to a SessionStart hook without changing what the model sees (Claude) — REVERSES the turn-6 instruction
- `--append-system-prompt` injects at the **real system-prompt level**, no documented size cap. (Claude CLI ref.)
- SessionStart `additionalContext` is injected as a **system-reminder in the conversation** (Claude reads it as plain text), **capped at 10,000 chars/field**, overflow offloaded to a file+preview. (Claude hooks ref.)
- CLAUDE.md is delivered as a **user message after the system prompt** — also not system-prompt level. (Claude memory doc.)
- There is **NO settings.json field** to append a system prompt — it is CLI-only. (Claude settings/CLI ref.)
- Codex: SessionStart `additionalContext` lands as **"developer context"** (verbatim), not system prompt; Codex has **no `--append-system-prompt`** at all. AGENTS.md context-level is **undocumented**. (Codex hooks/config ref.)

**Correction.** Moving the system surface to a SessionStart hook is a *behavioral change* on Claude
(system-prompt → system-reminder; + 10k cap). That collides with the hard "provably equivalent"
requirement. **Decision: the system surface STAYS on `--append-system-prompt` on the Claude path
(equivalence preserved). The hook-dispatcher convergence applies to the HOOKS only.** On Codex
(which has no system-prompt append and no prior behavior to preserve), the surface is delivered via
SessionStart `additionalContext` and/or AGENTS.md — documented as the harness ceiling, not a regression.
See §5.1. This is the single biggest correction and it is surfaced to the user, not silently taken.

### 1.2 Hook ordering is PARALLEL on BOTH harnesses — no array-order guarantee
- Claude: "all matching hooks run in parallel, identical commands deduped"; "every hook runs to completion before merging; one returning deny does not stop siblings"; PreToolUse decision merge = most-restrictive wins (`deny > defer > ask > allow`); `additionalContext` from every hook is kept.
- Codex: "Multiple matching command hooks for the same event are launched concurrently, so one hook cannot prevent another from starting"; `deny`/`continue:false` win regardless of order.

**Correction.** Today's `settingsJson` puts mark-active + spec-first in one PreToolUse `hooks[]` array
assuming array order. Order is NOT guaranteed natively. The two are independent by construction
(mark-active writes `.session/state`; spec-first owns the `.session/spec-checked` sentinel — different
files, no shared mutable state), so no latent bug. BUT the dispatcher must therefore: **run ALL claimed
hooks for an event (it can do so in deterministic `order`), let each do its side effects, and AGGREGATE
the decision (any block → block, stderr concatenated)** — it must NOT short-circuit on the first block,
or a side-effect hook (mark-active) ordered after a blocker (spec-first) would be skipped vs today where
both run. (Earlier plan said "short-circuit on first block" — that was wrong for equivalence.)
Sequential-deterministic dispatch is a strict *improvement* in determinism and is observably equivalent
here because the hooks are mutually independent and blocking is preserved.

### 1.3 De-absolutization: Claude has `CLAUDE_PROJECT_DIR`; Codex has NOTHING equivalent
- Claude: `${CLAUDE_PROJECT_DIR}` is the project root, available BOTH as a placeholder in hook config AND as an env var on the spawned hook process. The intended portable-path mechanism. (Claude hooks ref.) **Caveat to test:** does it resolve to the WORKTREE root or the MAIN checkout under a git-worktree layout?
- Codex: **no `CODEX_PROJECT_DIR`**. Hook commands run with `cwd` = session cwd; project root reaches a hook only via the stdin JSON `cwd` field. Only *plugin* hooks get `PLUGIN_ROOT`/`CLAUDE_PLUGIN_ROOT` aliases.

**Correction.** Kill the hardcoded `/root/spexcode/...` in hook commands. Claude shim → `"$CLAUDE_PROJECT_DIR"/...`;
Codex shim → cwd-relative (`./...`, dispatcher invoked with cwd=worktree). Both point at the one in-repo
dispatcher. RESIDUAL: hooks needing the tsx runtime (`$SPEX`) still need a resolvable Node/cli — see §5.4.

### 1.4 Codex hook stdin DIFFERS from Claude in load-bearing fields
Matches: `tool_name`, `tool_input`, `tool_response`, `hook_event_name`, `session_id`, `transcript_path`, `cwd`, `stop_hook_active`, `source`.
DIFFERS / ABSENT on Codex:
- **`file_path` does not exist anywhere in Codex hook input** (verbatim). Edits go through `apply_patch` with `tool_input.command`; no `file_path`. → `spec-first.sh` / `spec-of-file.sh` key on `file_path` → silently no-op on Codex.
- **No `Notification` event, no `notification_type`** → the `idle` hook has no Codex hook equivalent (use Codex `notify` = `agent-turn-complete`, an argv-JSON callback, NOT a hook).
- **No StopFailure / API-error event** → the `session fail` hook has no Codex equivalent.
- Codex-only: `permission_mode`, `turn_id`, `tool_use_id`, `last_assistant_message`, `model`.

**Correction.** A shared shell script works only for the OVERLAPPING fields. file_path-dependent and
notification/stopfailure hooks need Codex-specific handling (an apply_patch path-extractor; `notify` for
idle). Claude equivalence is unaffected (Claude keeps all its fields). See §5.2.

### 1.5 Codex session/launch differences (scopes the FULL Codex worker adapter OUT of this node)
- **No `--session-id`** (caller cannot choose the id; Codex assigns it, resume by a recorded id via `codex resume <id>` / `--last`). Claude has caller-chosen `--session-id <uuid>`.
- Skip-permissions analog = `--dangerously-bypass-approvals-and-sandbox` (alias `--yolo`); approvals/sandbox via `approval_policy` / `sandbox_mode`.
- **`codex app-server`** (JSON-RPC over stdio/WS/Unix socket, `turn/start` with threadId+input) IS a reliable inbound-relay channel — REFUTES the earlier "Codex relay must be tmux send-keys, no confirmation." Only the bare-TUI-in-tmux mode lacks it.
- Codex hooks-under-`codex exec`: **undocumented** whether exec runs hooks / honors trust / needs `--dangerously-bypass-hook-trust`. Must be tested live, not assumed.
- Codex does **not** write an OSC pane-title self-summary (confirmed by absence; worth a 30s live check).

**Correction.** The full Codex *worker launch/resume/relay* adapter is a SEPARATE, independently-scoped
node (sessions.ts CLAUDE_CMD/resume/rendezvous are Claude/reclaude-specific). THIS node delivers the
harness-agnostic **hook+prompt mechanism** and the committed Codex shim; it does not rewrite the launcher
for Codex. Surfaced so the work isn't conflated. See §5.5.

### 1.6 Confirmed (assumptions that survived)
- Committed project `.claude/settings.json` hooks MERGE with user/local/managed — shareable, the right home for the shim. (Claude settings.)
- Codex `.codex/hooks.json` (repo-level) is a valid discovery location; trust is hashed against the hook-command entry, so a **stable one-line shim trusted once lets the script evolve underneath** without re-prompting. (Codex hooks.)
- Stop `stop_hook_active` loop-guard is real on BOTH (Codex has it on Stop/SubagentStop). Claude adds a hard 8-block cap (`CLAUDE_CODE_STOP_HOOK_BLOCK_CAP`).
- PostToolUse `additionalContext` non-blocking — confirmed both.
- Retiring `hideClaudeMd` is sound IF the system surface comes from elsewhere (CLAUDE.md's only effect is auto-injection); cleaner than moving the file: `claudeMdExcludes` setting or `--bare`/`--safe-mode`. NOTE: on the Claude path the system surface STAYS on `--append-system-prompt`, and CLAUDE.md is already moved today — retiring the move is OPTIONAL and out of scope for equivalence; left as-is to minimize the diff.

---

## §2. Corrected architecture (to be implemented)

### 2.1 The `surface: hook` extension (reuse the EXISTING field-driven routing)
`specs.ts loadSurface` already routes `.config` nodes by a `surface` field (`system` → folded into the
prompt; `slash` → a /command). Add **`hook`** as a third value. A hook node lives under `.config/core/<id>/`
(folder-as-unit: `spec.md` + co-located script) and declares in frontmatter:
```yaml
surface: hook
events: [PreToolUse, UserPromptSubmit]   # one node may bind several events (mark-active does)
order: 20                                  # deterministic intra-event order
block: false                               # intent-to-block (only honored on block-capable events)
```
"properly claimed" == a built/active `.config` node with `surface: hook`. A `pending` node or an orphan
script with no node does NOT run — identical to how `surface: system` gather already skips pending. The
registry IS the spec tree; there is no separate registry file to drift.

`.config/core` stays the `surface: system` contract node (decision A); the hook nodes become its CHILDREN.

### 2.2 Compile-once, dispatch-cheap
- A **SessionStart** shim (both harnesses fire it) compiles all `surface:hook` bindings into a flat
  per-session manifest `\.session/hooks-manifest` (lines: `event<TAB>order<TAB>block<TAB>command`). The
  compile is the only place that parses frontmatter, runs ONCE, so it may use the tsx cli.
- A **per-event** shim (one line per harness event) invokes the pure-POSIX-shell dispatcher
  `dispatch <event>`; it greps the manifest for `<event>`, sorts by `order`, runs each command with the
  original hook stdin piped through, and AGGREGATES exit codes (any `2` → exit 2, stderr concatenated;
  on non-block-capable events the block is swallowed and lint-warned at author time). Hot path = one
  `grep` + `sort` + the sub-hooks; no node boot per tool call.

### 2.3 The committed shims (tiny, stable, de-absolutized)
- `.claude/settings.json` — one `hooks` entry per harness event → `"$CLAUDE_PROJECT_DIR"/<dispatch> <Event>`,
  plus the SessionStart compile line. Committed, merges with user settings. (System prompt stays on the
  `--append-system-prompt` launch flag — NOT in this file.)
- `.codex/hooks.json` — the same shim lines, cwd-relative; trusted once.
These two thin manifests point at ONE shared dispatcher + ONE shared `.config/core/*` script set.

### 2.4 What sessions.ts changes (Claude path, equivalence-critical)
`settingsJson()` stops hardcoding the 6 hooks at MAIN absolute paths. It either (a) writes the shim that
calls the dispatcher, or (b) is replaced by the committed `.claude/settings.json` (passed via the existing
`--settings` or discovered). `appendSysArg()` is UNCHANGED (system surface stays system-prompt level).
The de-absolutization removes the `/root/spexcode/...` literals.

---

## §3. Equivalence proof (Claude/reclaude path) — to be completed against the implementation

Scope: the dashboard/CLI-launched **Claude** path must be behaviorally identical before/after. Codex is
additive (no prior behavior). Proof obligation, per hook event E and the system surface S:

- **S (system surface):** UNCHANGED — same `loadSystemConfig()` gather, same `--append-system-prompt`,
  same bytes, same position. Equivalence is by identity (no code change). ∎ (pending: confirm appendSysArg untouched)
- **For each event E:** the set of scripts run, their stdin, their cwd, their env (`$SPEX`), and the
  aggregate exit/stderr/additionalContext must equal today's `settingsJson` wiring. Sub-claims:
  - (i) Same scripts on same events: the manifest compiled from the migrated `.config/core/*` nodes must
    equal the old hardcoded map. VERIFY by byte-diffing compiled manifest vs the old hooks.json semantics.
  - (ii) Same stdin/cwd/env: dispatcher pipes the unmodified hook stdin and runs with cwd=worktree, $SPEX
    injected as today.
  - (iii) Same decision: aggregate (any exit 2 → 2) reproduces today's per-event blocking, because at most
    one block-capable hook exists per event today (spec-first on PreToolUse; stop-gate on Stop) and the
    side-effect hooks always ran regardless of the blocker (parallel today; all-run in dispatcher).
  - (iv) Ordering inertness: the only intra-event multi-hook case is PreToolUse {mark-active, spec-first};
    they touch disjoint state (state file vs sentinel) → any order yields the same final state. ∎

The proof is only SOUND once the manifest-equals-old-map check passes on a real launch. §6 tests it.

---

## §4. Scenario suite (SpexCode yatsu) — to be authored

Each migrated hook node + the dispatcher node gets a yatsu scenario asserting equivalence-relevant behavior,
e.g.: dispatcher fires mark-active+spec-first on PreToolUse with spec-first blocking once; stop-gate blocks
an undeclared/uncommitted stop; manifest compiled == legacy map; bare-launch (no dashboard) still wires
hooks. Stress angles: empty manifest, a pending hook node (must NOT run), a multi-event node, a block on a
non-block-capable event (must lint-warn, not crash).

---

## §5. Compromises (each pushed to its limit FIRST; filled in as the build hits them)

- §5.1 System surface on Codex is developer-context / AGENTS.md, NOT system-prompt level (Codex has no
  append-system-prompt). Limit reached: there is no system-prompt-level injection in Codex. Documented, not faked.
- §5.2 file_path-dependent hooks (spec-first, spec-of-file) need a Codex apply_patch path-extractor; idle/fail
  have no Codex hook event (use `notify`). [pending: attempt the extractor before calling it a compromise]
- §5.3 Bare-launch system prompt: a discovered file can only deliver it at user-message level (CLAUDE.md/AGENTS.md),
  not system-prompt; dashboard launch keeps system-prompt level via the flag. [characterize]
- §5.4 `$SPEX` runtime for tsx-needing hooks in a fresh worktree without node_modules. [attempt portable resolve]
- §5.5 Full Codex worker launch/resume/relay (no `--session-id`; app-server vs tmux; notify) — separate node.

---

## §6. Test log

- **Loader change (recursive `surface:hook` support) — EQUIVALENCE VERIFIED.** After making `loadSurface`
  recursive: `loadSystemConfig()` = {core, forge-link, sanity-check, voice-before-ask} and `loadConfig()`
  (slash) = {extract, health, regroup, scenario, supervisor, tidy} — unchanged. Proven equivalent because
  ALL `surface:system|slash` nodes in the tree are depth-1 direct children of a config root (measured), so
  recursion yields the identical set; nested nodes only ever carry `surface:hook`. `search-first`
  (surface:system but status:pending) stays filtered out → pending filter intact in the recursive version.
  `appendSysArg()` = 3365 bytes, frozen to /tmp/golden-appendsys.txt as the system-surface golden ref.
  spec-cli typecheck (tsc --noEmit) = 0 errors.
- **Golden legacy hook map** (frozen from `settingsJson`, the equivalence target for the compiler):
  | node | events | order | block | runtime |
  |---|---|---|---|---|
  | mark-active | UserPromptSubmit, PreToolUse | 10 | false | pure shell |
  | spec-first | PreToolUse | 20 | true | pure shell |
  | spec-of-file | PostToolUse | 10 | false | $SPEX |
  | stop-gate | Stop | 10 | true | $SPEX |
  | session-fail | StopFailure | 10 | false | $SPEX |
  | idle | Notification | 10 | false | $SPEX |
- (next: compiled-manifest == legacy map; real launched session fires hooks identically; …)
