---
concern: Codex lifecycle hooks don't fire for a dispatched codex worker in a freshly-adopted project (Stop gate never enforced; commit lacks Session: trailer)
by: 508d36a9-84cb-4c2d-a945-789b4f7d0112
status: open
nodes: harness-adapter
created: 2026-07-04T04:19:44.556Z
---

Found during an end-to-end adoption dogfood (fixture: /root/e2e-dogfood-2026-07-03, a fresh vite+react app adopted via `spex init`, backend on :8799 with SPEXCODE_CODEX_BYPASS_HOOK_TRUST=1). Two workers dispatched, identical shape: reclaude (claude) → node `due-date`, codex → node `priority`.

SYMPTOM (codex, session ed10169b): none of the SpexCode lifecycle hooks fired.
- The global session dir `/root/.spexcode/projects/-root-e2e-dogfood-2026-07-03/sessions/ed10169b.../` holds ONLY launch-time files (launch.sh, prompt, session.json). NO hook-written sentinels.
- session.json froze at `status: active` from launch (20:34) and was never touched again through 16 min of work — mark-active never ran.
- The worker committed real spec+code but ended UNDECLARED in `working`: the Stop gate never blocked/forced a declaration.
- The commit (72d1693) has NO `Session:` trailer — the prepare-commit-msg stamp didn't reach codex's git subprocess.

CONTRAST (reclaude, session 564714b5, SAME fixture/backend): all hooks fired.
- session dir has `spec-checked` (spec-first) + `spec-of-file-seen` (spec-of-file) sentinels.
- Stop gate fired (session.json note "stopped with uncommitted work — commit your spec+code…", status flipped to `asking`).
- commit 8871dc0 carries `Session: 564714b5-…`.

DIAGNOSIS: the bypass-decision path is CORRECT — toolchain is at 5e359e6 (incl. tonight's fix 178d5d0), and with SPEXCODE_CODEX_BYPASS_HOOK_TRUST=1 forced, `codexSupportsBypassHookTrust` returns true, so `codex-launch` calls `codexStartThread(sock, cwd, bypassHookTrust=true)` — thread/start carries `config.bypass_hook_trust`. The break is DOWNSTREAM of the decision: the codex worker's actual execution (tool calls, git commits, hook events) runs inside the SHARED per-project `codex app-server` (pid was healthy, socket /tmp/spexcode-cx-*.sock), which is session-agnostic — it lacks per-session SPEXCODE_SESSION_ID and evidently does not invoke the worktree's lifecycle hooks for the thread. So both the missing hooks AND the missing Session: trailer share one root: per-session identity/hook wiring doesn't reach the codex thread in the --remote app-server topology. The claude path spawns a dedicated per-session process (.claude/settings.json hooks + SPEXCODE_SESSION_ID), so it all works.

Net: contract CONTENT still reaches codex via AGENTS.md auto-discovery (it followed the ritual), which MASKS the failure except at the Stop gate (no enforcement) and the board (frozen state). Needs codex-rs-side verification of whether thread/start `config.bypass_hook_trust` actually enables hook execution on 0.142.5, and how per-session env reaches the thread. Exhibit left on disk: fixture + both session dirs.
