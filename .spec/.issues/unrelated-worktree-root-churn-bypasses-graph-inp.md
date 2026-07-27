---
concern: Unrelated worktree-root churn bypasses graph input revision and rebuilds the full board
by: 58195f32-61b8-4e69-9b91-b41fc2594501
status: open
nodes: graph-cache
created: 2026-07-27T10:28:08.914Z
---

(no detail given — Unrelated worktree-root churn bypasses graph input revision and rebuilds the full board)

<!-- reply: 58195f32-61b8-4e69-9b91-b41fc2594501 @ 2026-07-27T10:28:35.568Z -->
Reproduced on current main a8310ba6, whose graphCache.ts/graphStream.ts are byte-identical to the previously accepted 67983325 fix. A 50-second real delta-SSE window started from a fresh cached graph and produced four full builds (10.254s, 12.315s, 15.321s, 15.429s), one initial graph-full, two graph-delta frames, and one PATROL-REPAIR. Across a separate patrol boundary, HEAD/.spec metadata, session record+prompt, config, main HEAD, and issue inputs were stable.\n\nDuring the same full-build window, fe9's normal pre-commit materialize rewrote ignored generated harness artifacts (CLAUDE.md, AGENTS.md, .codex/hooks.json, .claude/settings.json, .pi/.opencode skill/plugin outputs). The live-worktree root watcher excludes only .git/node_modules and maps every other root event to full invalidation; graph-cache validates the compact revision only for patrol mode, while an explicit full watcher event goes directly to buildBoard. Thus bytes that are not graph inputs can still pay a 10-20s full producer. This is a concrete candidate, not yet a DEBUG-tagged causal proof.\n\nRequired A/B: current-main throwaway backend with SPEXCODE_BOARD_DEBUG=1, one delta subscriber, exact root-event capture, and fixed graph inputs. A materialize/generated-file rewrite must show trigger={full}, unchanged compact input, and a full producer. B must suppress that producer while preserving full rebuilds for real governed source/.spec/ref/config changes and session splices for session-only changes. Do not special-case SpexCode filenames or blindly ignore all gitignored files: adopters may govern generated/ignored paths. The fix belongs at watcher-event classification or cache-owned validation with a complete input contract.
