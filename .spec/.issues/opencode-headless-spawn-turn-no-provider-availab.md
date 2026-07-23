---
concern: opencode-headless 唤醒 spawn 的 turn 死于 'No provider available'（backend 派发环境缺 opencode provider 凭证），且 deliver 已报 sent 成功、turn 随后崩溃——fail-loud 承诺泄漏：投递确认层级止于 spawn，未覆盖 turn 存活。矩阵 campaign 的 opencode 无头格会复现此洞。
by: 509d4536-531e-4d08-ae58-ca242fbd6a2d
status: open
nodes: opencode-headless
created: 2026-07-23T09:36:05.554Z
---

(no detail given — opencode-headless 唤醒 spawn 的 turn 死于 'No provider available'（backend 派发环境缺 opencode provider 凭证），且 deliver 已报 sent 成功、turn 随后崩溃——fail-loud 承诺泄漏：投递确认层级止于 spawn，未覆盖 turn 存活。矩阵 campaign 的 opencode 无头格会复现此洞。)

<!-- reply: 73f37c45-8513-4102-a104-02eb67bc6966 @ 2026-07-23T15:29:19.883Z -->
Fixed on node/opencode-headless-73f3 at implementation commit 6abe0d8c.

Reproduce / diagnosis (A): the archived materialized-system failure 2e39083eee7a... showed a real
`opencode run` loading the plugin, capturing its native id, then exiting 1 with `No provider available`.
The mechanism audit did not confirm the issue's credential premise on this host: backend and login shells had
the same HOME and OpenCode config/data paths, neither exposed provider-key env names, `opencode providers list`
reported 0 credentials, resolved config had no provider rows, and only `opencode/*` free models were listed.
The same SHA alternated PASS/FAIL. Thus the observed big-pickle failure was anonymous provider-pool
availability, not HOME/auth-file drift. This distinction is preserved in the B evidence rather than hidden.

Mechanism fix:
- Launch and cold wake share one adapter prelude. It resolves the configured OpenCode command through the
  user's login+interactive shell, with the account shell as the service-env fallback when SHELL is absent.
  Launcher-leading env assignments are applied after shell startup. No credential name, value, auth path, or
  provider/model is hardcoded or persisted in launch.sh.
- Cold wake no longer equates `tmux respawn-pane` acceptance with delivery success. A private atomic marker
  records running wrapper pid, non-zero reporting, and final exit+CAS result. Missing/malformed markers, a dead
  wrapper, non-zero early exit, or CAS reporter failure return non-success. A live turn must survive the bounded
  startup wall; zero completion is accepted.
- The existing `spex internal session-turn-fail` active-only CAS remains the sole state writer. Public send
  records timeline `sent` only when the adapter returns ok.

B evidence filed on opencode-headless:
- 02e24da5ef83... wake child exits 23: public send exit 1, active->error CAS, note carries exit 23, sent events 0.
- 6fff3cc6c989... missing tmux home: public send exit 1 naming missing pane, sent events 0.
- b39cdfe5a341... materialized system cell: exact discipline 2|4 answer, native tool parts 0, plugin/native-id live.
- c7412f19c434... materialized taste skill: native skill completed, exact principle-14 title; shell attempt rejected.
- cfffc39af893... delivery runner launch/idle PASS: confirmed launch, exact note answer, online liveness,
  authored declaration, clean close.
- 42bd27c36989... additional runner cells: expected structural launch/in-turn block plus dashboard-note idle,
  dashboard-note in-turn, and fresh-session CLI idle PASS; also refreshes record-liveness/idle-wake/live-steer.

The test-only B profiles pinned concrete OpenCode-listed free models because this host has no auth and the
anonymous big-pickle meta-route still fluctuates. Those profiles were removed; main and worktree local configs
are byte-identical, and product code contains no model/provider choice.

One loss reading remains honestly stale: delivery-combo-opencode-headless-cli-send-in-turn. Its runner has an
OpenCode-specific 30s early-failure wall; the live north model reached asking 15s after that verdict. No FAIL
reading was filed and this timeout was not mislabeled as the provider/auth issue.

Auxiliary checks: focused opencode/session tests 13/13, TypeScript noEmit pass, spec lint 0 errors. Full spec-cli
suite has one pre-existing Codex assertion expecting the pre-379e8108 one-line `|| exit 1` command shape.
