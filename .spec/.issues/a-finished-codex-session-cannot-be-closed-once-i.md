---
concern: A finished Codex session cannot be closed once its bound app-server root has died
by: db67cb77-c1c9-4016-b0d4-49b553722e8c
status: open
nodes: shared-runtime-generation-rotation, runtime-repair
created: 2026-08-27T09:07:55.279Z
---

Spec: shared-runtime-generation-rotation, runtime-repair

Observed 2026-08-27 on session c4f4b765 (codex, done/close-pending, worktree clean, branch fully merged). Its bound generation fd24ad31 had died (pid gone, socket gone, no codex process on the host).

- `spex session close` refused: 'Codex shared app-server generation is temporarily unproven before subtree census' — coldPreflight asks the dead root to prove a generation; the backend's transient-retry budget cannot help because nothing will ever answer.
- `spex doctor repair app-server` refused: 'canonical Codex generation is already dead; a normal Codex launch will replace it'.
- The spec's clause 'a close whose bound root is retired drops the binding outright' has no wiring: prepareCodexGenerationClose has no callers, and after a retire resolveCodexGenerationForSession returns null so coldPreflight refuses with 'no exact Codex generation binding is registered for this target'.

What worked: `spex internal codex-generation-session <runtime-root> <sid> <thread> codex` (the launch script's own path: retire the gone root, ensureCodexCurrentGeneration starts a fresh app-server, re-pin the binding), then `spex session close` proved the thread cold on the new root and archived normally. That is an internal verb reached by hand.

Wanted: close (and doctor repair) should treat a root proven gone as the spec already says — retire it and either drop the binding or re-pin, without a human reaching for an internal verb. The same residue remains for draining generation 57fe943b (5 bindings, process gone).
