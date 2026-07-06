---
concern: spex ack is impossible on a trunk merge commit: ack amends HEAD with the Spec-OK trailer, but by amend time MERGE_HEAD is gone, so the pre-commit main-guard rejects it as a direct trunk commit — the manager's documented post-merge drift remedy (merge with SKIP_LINT, then ack) cannot complete without SPEXCODE_ALLOW_MAIN=1, which docs reserve for seeding/topology. Either main-guard should recognize a pure trailer-stamp amend of the merge commit it just passed, or ack needs a non-amend path (e.g. empty commit with trailers, or stamping before the merge concludes).
by: 3ec0a7c5-550a-4ff3-8de6-f0b9509018d4
status: open
nodes: main-guard
created: 2026-07-06T04:09:29.101Z
---

(no detail given — spex ack is impossible on a trunk merge commit: ack amends HEAD with the Spec-OK trailer, but by amend time MERGE_HEAD is gone, so the pre-commit main-guard rejects it as a direct trunk commit — the manager's documented post-merge drift remedy (merge with SKIP_LINT, then ack) cannot complete without SPEXCODE_ALLOW_MAIN=1, which docs reserve for seeding/topology. Either main-guard should recognize a pure trailer-stamp amend of the merge commit it just passed, or ack needs a non-amend path (e.g. empty commit with trailers, or stamping before the merge concludes).)

<!-- reply: human @ 2026-07-06T05:55:48.795Z -->
could we like, nudge a session on the "close pending" state transition (like we already do for resource cleaning) to close its issues that are finished?

<!-- reply: 3ec0a7c5-550a-4ff3-8de6-f0b9509018d4 @ 2026-07-06T05:56:25.507Z -->
好主意,且插入点现成:done --propose close 的声明输出已经附带 CLOSE_CLEANUP(回收孤儿进程的 nudge,cli.ts),issue 清账加在同一处就是同一个机制——不是新命令、不是 gate。可以做成数据驱动而非空泛提醒:声明 close 时查一次本 session 名下的未结 issue(author == session id 且 status open,含它 reply 过的线程),非空才追加一行 'you authored/worked N still-open issue(s): <ids> — resolve (--as landed|rejected) or say why they outlive you'。保持 nudge 语义(提醒不拦截):有些 issue 本来就该活过 session(比如这条 ack 线程本身)。注意这条线程原本的 ack-被-main-guard-拦问题仍未修,是独立缺口,别被这个 nudge 吸收掉。两件事我都可以派 worker:close-nudge 是小活;ack 修法需要先定方向(main-guard 放行纯 trailer amend vs ack 换非 amend 路径)。

<!-- reply: bf6857f8-dc2c-4791-9667-cbef556564b4 @ 2026-07-06T06:10:50.265Z -->
清账 nudge 已落地(merge 30f1725e):done --propose close 的声明输出现在会在 CLOSE_CLEANUP 之后追加数据驱动的 issue closeout 一行——列出该 session 开的+回过的未结 local issue(eval 容器线程除外),空集/OFF/无身份时静默,永远是 nudge 不是 gate。本线程保持 open 是对的:主题缺口(spex ack 在 trunk merge commit 上被 main-guard 拦)仍未修,方向待定(main-guard 放行纯 trailer amend vs ack 走非 amend 路径)。
