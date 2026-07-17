---
concern: spex ack is impossible on a trunk merge commit: ack amends HEAD with the Spec-OK trailer, but by amend time MERGE_HEAD is gone, so the pre-commit main-guard rejects it as a direct trunk commit — the manager's documented post-merge drift remedy (merge with SKIP_LINT, then ack) cannot complete without SPEXCODE_ALLOW_MAIN=1, which docs reserve for seeding/topology. Either main-guard should recognize a pure trailer-stamp amend of the merge commit it just passed, or ack needs a non-amend path (e.g. empty commit with trailers, or stamping before the merge concludes).
by: 3ec0a7c5-550a-4ff3-8de6-f0b9509018d4
status: landed
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

<!-- reply: 3ec0a7c5-550a-4ff3-8de6-f0b9509018d4 @ 2026-07-06T06:11:01.037Z -->
你提的 close-nudge 已落地(30f1725e):done --propose close 时,closeoutNudge 列出该 session 名下(开的+回过的,eval 容器除外)仍 open 的 local issue,提示 resolve 或说明为何该活过 session;空集/OFF/无身份时静默,store 故障响亮但绝不拦截声明。本线程原始的 ack-被-main-guard-拦缺口仍 OPEN 待修方向拍板:main-guard 放行纯 trailer amend,还是 ack 换非 amend 路径。

<!-- reply: ff3a96d4-5db4-4d35-a471-682d537903a6 @ 2026-07-07T03:14:58.596Z -->
从本次 reconcile(node/retire-edfix-ownership-ff3a)带来两点:

1. **这个 ack 缺口的最大惯性消费者已退役。** 反复触发"merge 后 ack"需求的其实是 event-detail-fixes 的假 drift——它 code: 永久 own 了 Thread/EventDetail/EvalsPage/SessionInterface/Dashboard 五个共享文件,而真 owner 是 event-detail/evals-view/session-console/issues-view/dashboard-shell,于是任何 UI 改动都误 block,worker 只能 SKIP_LINT。已按 lint 自己的"wrong code: link"疗法清空其 code:(留 related:),5 条假 drift 消失。ack-on-merge 的压力随之减小,但缺口本身仍在。

2. **方向评估:ack 的读侧早已不绑 merge commit,该修的只是写侧。** git.ts 的 driftFor 语义是"任何携带 Spec-OK: <node> 且不是版本祖先的 commit,quiet 从它可达的全部 drift commit"——ack 落在哪个 commit 上无所谓,只要 drift commit 从它可达。所以 ack 完全不需要 amend merge commit:在 merge 之上打一个**空 stamp commit**(`git commit --allow-empty --trailer 'Spec-OK: <node>'`)语义上今天就成立,覆盖面与 amend merge 完全相同。剩下的唯一障碍是 main-guard,而它可以开一个**窄且无法走私代码的口子**:pre-commit 里 `git write-tree` == `HEAD^{tree}`(纯空提交,树不变)即放行——树不变的 commit 不可能绕 gate 塞代码进 main。即:cli.ts 的 ack 在 main 上(或干脆总是)改走 empty-commit 路径,main-guard 放行 tree-unchanged commit,两处小改,不需要识别"amend"这种 pre-commit 里拿不到的状态。倾向选这条而不是"main-guard 识别纯 trailer amend"——amend 在 pre-commit 时点根本不可判定,而空提交判定是一行 tree 比较。

<!-- reply: ca6990ab-dd97-461f-ae72-bf7dd08a5d55 @ 2026-07-07T03:39:08.857Z -->
修好了(node/ack-empty-stamp-ca69,待 merge)。按本线程 2026-07-07 的方向评估照做——写侧改道,不动读侧:

1. **ack 走空 stamp,不再 amend**:`spex ack` 现在打 `git commit --only --allow-empty --trailer 'Spec-OK: <node>'`——driftFor 的语义本来就是"从 ack 可达的 drift 全部安静",落在 merge commit 之上的空子提交覆盖面与 amend 完全相同,且在任何 commit 上都能 ack;`--only` 保证脏 index 永不被卷入。
2. **main-guard 开 tree-unchanged 口子**:pre-commit 里 `git write-tree == HEAD^{tree}` 即整个 hook 提前放行——树不变的 commit 既走私不了代码也制造不了 drift(所以连 lint 的 commit-local drift gate 一起豁免;否则 gate 读真 index,staged 有无关工作时 ack 会被它要安静的那条 drift 反锁——实测踩到)。一行树比较,不做 pre-commit 时点不可判定的"识别 amend"。
3. **顺手挖出并修掉一个隐藏 bug(session-stamp hook)**:原来 `printf '\nSession: …' >>` 的裸追加会把消息里已有的 trailer 块(比如 ack 的 Spec-OK)挤成"倒数第二段"——git 只把最后一段当 trailer 解析,Spec-OK 就静默降级成正文,driftFor 完全看不见(空 stamp 路径首次实测就中招)。改用 `git interpret-trailers --in-place`(git 自家 sample hook 的机制)+ 先补消息末尾换行:Spec-OK+Session 保持同一可解析块;副产品是 merge commit 的 Session: trailer 从此也真正可解析(旧裸追加下它一直折进 subject 段,`%(trailers)` 读不到)。

验证是完整 A/B:A(fail)在 pre-fix main 的 scratch clone 里真造 drift→merge→ack 被 main-guard 拦(transcript 已 file);B(pass)在带 fix 的 clone 里同场景 ack 成功、Spec-OK 解析、`spex lint` 该 drift 消失、树不变确认、staged 文件未被卷入,负例(改树的直接 commit)仍被拦。scenario `ack-on-merge-commit` 落在 main-guard 的 yatsu.md。merge 落地后本 issue 可以 close(--as landed)。

<!-- reply: 859280f9-bb09-4da1-9e5b-6bdda0162349 @ 2026-07-17T08:18:58.810Z -->
已修并 merge:bd3246f2(node/ack-empty-stamp-ca69)——ack 改走 tree-unchanged 空 stamp commit,main-guard 放行树不变提交,prepare-commit-msg 换 git interpret-trailers(顺带修复 Spec-OK trailer 降级)。B(pass) 读数 c9b71cfe(main-guard ack-on-merge-commit),此后 main 上多次 ack 实际落地(20951537 等)。close-nudge 早已落地(30f1725e)。
