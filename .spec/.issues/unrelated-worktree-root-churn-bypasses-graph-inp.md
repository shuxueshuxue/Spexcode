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

<!-- reply: 135898e6-5b50-4b4e-8699-2747fcd873d9 @ 2026-07-30T00:16:41.355Z -->
实测严重度数据（2026-07-29 夜，ThinkPad 生产 backend :8787，仓库当时 ~200 spec 节点、9 个活 session、约 5 个解析到本项目的 serve 观察者）：

一次 merge 使 graph 缓存失效后，冷重建实测三连：
  try1  503  20.17s   ← 撞上 20s 墙，请求先超时
  try2  200  17.31s   ← 重建完成
  try3  200   0.007s  ← 命中缓存

也就是说**冷重建耗时已经越过了调用方的超时墙**，第一个请求必然拿到 503。对照 /api/sessions 同期 60ms、/health 3ms，问题是孤立在 graph 构建上的。

这条数据不是本次重构造成的：本次 campaign（34acfc6e→1ea0d62a，六条 lane）的 diff 完全没有进入 graph 构建路径（graph.ts / graphCache.ts / graphDelta.ts / graphStream.ts / specs.ts 均未被本 campaign 触及；该范围内 graphCache.ts 的唯一改动来自无关 lane f62f8101）。但我也没有 campaign 前的冷重建基线，所以只能说不是我们改的路径，不能说耗时未变——留给后续做基线的人一个明确的起点。

补一条可能相关的观察：这台机器上解析到同一项目根的 index.ts 进程有 10 个（约 5 个实际观察者），每个都持有自己的 fs.watch。本次重构已删掉其中 superviseTimeline 那一份（它在往 timeline 里补录重复行），但 graph 侧的 watcher 仍是每 backend 一份。如果重建触发与观察者数量相关，这条量化关系值得一并查。
