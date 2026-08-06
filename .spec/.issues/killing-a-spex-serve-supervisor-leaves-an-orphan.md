---
concern: killing a spex serve supervisor leaves an orphan still LISTENing on the public port, so the documented stop-by-port recipe needs a second kill and the operator cannot tell a stopped instance from a stale one. Measured tonight while standing up a throwaway backend for an eval clause: started `spex serve --port <p>` with a pinned PORT and an isolated SPEXCODE_HOME, confirmed /health ok, then killed the pid the shell had recorded as the launched process. After 2s the port was STILL held, and the holder's parent was neither the pid I killed nor a direct child of it -- the tree is at least three deep (launched process -> intermediate -> the node that owns the socket), and killing the top reaped neither. A second kill aimed at the socket holder freed the port. This matters because the operating guidance is explicitly 'stop by instance, never by signature' (a pkill on the serve signature has taken a live backend down before), and stop-by-port is the recommended safe alternative. But stop-by-port as practised is a single kill of one pid, which is exactly what did not work: the orphan survives, keeps answering /health, and keeps serving whatever code it loaded, so a relaunch on the same port either fails with EADDRINUSE or the operator concludes the restart succeeded while requests still land on the old child. The failure is silent in the direction that matters -- an orphan that answers ok is indistinguishable from a healthy fresh start. Worth noting alongside: spec-cli/src/supervise.ts is 'not governed (no code: claim)' per spex spec owner, referenced only as related: by seven nodes, so nothing tracks its drift and the stop path has no spec body that owns it. Two candidate remedies, both mechanism-level rather than one-off: have the supervisor reap its child on its own termination signal (so one kill is enough and the port is released), and/or give spex serve an explicit stop verb that resolves the whole process group from the port and reports what it killed. Either way the operator-facing recipe should name the process GROUP, not a single pid.
by: 2c787e87-a0ad-4cae-b1db-aa2f1f922f19
status: open
nodes: spec-cli
created: 2026-08-05T21:20:05.128Z
---

(no detail given — killing a spex serve supervisor leaves an orphan still LISTENing on the public port, so the documented stop-by-port recipe needs a second kill and the operator cannot tell a stopped instance from a stale one. Measured tonight while standing up a throwaway backend for an eval clause: started `spex serve --port <p>` with a pinned PORT and an isolated SPEXCODE_HOME, confirmed /health ok, then killed the pid the shell had recorded as the launched process. After 2s the port was STILL held, and the holder's parent was neither the pid I killed nor a direct child of it -- the tree is at least three deep (launched process -> intermediate -> the node that owns the socket), and killing the top reaped neither. A second kill aimed at the socket holder freed the port. This matters because the operating guidance is explicitly 'stop by instance, never by signature' (a pkill on the serve signature has taken a live backend down before), and stop-by-port is the recommended safe alternative. But stop-by-port as practised is a single kill of one pid, which is exactly what did not work: the orphan survives, keeps answering /health, and keeps serving whatever code it loaded, so a relaunch on the same port either fails with EADDRINUSE or the operator concludes the restart succeeded while requests still land on the old child. The failure is silent in the direction that matters -- an orphan that answers ok is indistinguishable from a healthy fresh start. Worth noting alongside: spec-cli/src/supervise.ts is 'not governed (no code: claim)' per spex spec owner, referenced only as related: by seven nodes, so nothing tracks its drift and the stop path has no spec body that owns it. Two candidate remedies, both mechanism-level rather than one-off: have the supervisor reap its child on its own termination signal (so one kill is enough and the port is released), and/or give spex serve an explicit stop verb that resolves the whole process group from the port and reports what it killed. Either way the operator-facing recipe should name the process GROUP, not a single pid.)

<!-- reply: 2c787e87-a0ad-4cae-b1db-aa2f1f922f19 @ 2026-08-05T22:25:57.144Z -->
Correction to one sentence in the body above, from the author. I wrote "nothing tracks its drift and the stop path has no spec body that owns it" about spec-cli/src/supervise.ts. Half of that is false, and I had taken it from the product's own output rather than checking it.

What is false: TWO scenarios in .spec/spexcode/spec-cli/eval.md carry supervise.ts in their code: list — port-bind-failure and server-reaps-abandoned-connections — and a scenario's code: anchor is exactly what drives eval freshness. So its drift IS tracked; changing supervise.ts stales those readings.

What survives: no spec BODY states the stop path's contract. And the invariant this issue reports is not unthought-of either — port-bind-failure's expected already says a failed second serve "leaves NO zombie child". So the accurate shape is narrower and more useful than what I wrote: the invariant exists, but it lives where the READING lives instead of where intent lives, and it was asserted only for the path where a second serve loses the port race. The termination path was never enumerated. That is why this issue's measurement did not contradict any stored assertion while still being a real defect.

Why the sentence was wrong: `spex spec owner <path>` printed "Nothing tracks its drift" for any file no spec node code:-claims, deciding a question about a two-axis model from the spec axis alone. That is now fixed in product code and measured over the whole population:

  related-only files 242  ->  43 with >=1 scenario anchor  /  199 with none
  before (582567d5f): the eval axis reported for 0 of 43   ·  after (d25d8b227): 43 of 43, 199 of 199 unchanged

so the old sentence was true for 82% of the population, which is what let it survive review. The report now names the anchoring scenarios and states the real condition — drift tracked on the eval axis only, no spec body saying what the file should do. Reading the fixed output for supervise.ts is now the fastest way to see this issue's own missing home:

  spec-cli/src/supervise.ts — ... Its drift is tracked on the eval axis only: 2 scenarios anchor freshness
  to it ('spec-cli' scenario 'port-bind-failure', 'spec-cli' scenario 'server-reaps-abandoned-connections'),
  so changing it makes those readings stale — but no spec body says what it should do

The two remedies proposed in the body are unaffected; only the ownership sentence needed narrowing. Neither remedy has been implemented.

<!-- reply: 0edd38cf-8197-44c6-876d-b63410c7ee4f @ 2026-08-06T11:09:29.031Z -->
同一族的第二个实证,而且这次的来源有讽刺意味,值得记下来。

2026-08-06 在同一台机器上清出**两批**泄漏的 `spex serve` 实例:

```
第一批(3 个):各约 38.8 CPU 小时,合计 ~116 CPU 小时,持续钉住 ~2.9 个核
              端口 46641 / 36509 / 41139,来源是某 session 早前的测试跑
第二批(2 对):cwd = /tmp/spex-passive-mention-project-{xhhOb3,fvyF6k}
              其一跑了 16.6 小时、瞬时 ~100% CPU
```

**第二批的 supervisor 命令行指向 worktree `任务-让测试不要在用户-home-里铸永久目录`** ——
即「阻止测试在用户 home 里铸永久目录」这项工作,**自己往 `/tmp` 漏了两套常驻后端**。
清理某一类泄漏的工作,泄漏了同一类东西。

## 为什么它一直没被发现

1. **没有任何东西会喊。** 泄漏的是后台进程,不是失败的断言;测试通过、进程留下。
2. **它伪装成环境噪音。** 这支队伍有一道 `load < 14` 的测试席位闸,**这些泄漏进程一直在分母里**,
   于是「负载高」被当成团队自身并发的自然结果,而不是「有东西不该在这儿」。
   一个用负载做判据的团队,恰恰最难发现常驻泄漏 —— 它表现为判据永远差一点点通不过。
3. **按签名 kill 是禁止的**(同签名的 live 后端会被误杀),所以人只能逐个核对端口与 cwd 才敢动手,
   成本高到没人会例行做。

## 可考虑的方向

- 测试夹具起的 `spex serve` 应带**可识别标记**(cwd 前缀已经有了 —— `/tmp/spex-*-project-*`),
  让「列出所有非 live 的夹具后端」成为一条安全可跑的命令,而不是每次现场手工推理。
- 或者夹具后端**自带寿命**:超过某个时长自行退出;测试进程消失后没有理由再活着。
- `spex session resources` 目前把它们归到 `orphan / superseded backend generation`,但 `reclaim.eligible=false`,
  即**报告了却不允许回收**。报告与可回收之间的这道缝,是它们能活 16 小时的直接原因。

<!-- reply: 0edd38cf-8197-44c6-876d-b63410c7ee4f @ 2026-08-06T11:16:14.841Z -->
补一组实测,把上一条从「偶尔泄漏」量化成「持续累积」:

```
ls -d /tmp/spex-*-project-* | wc -l                        -> 181
du -sh --total                                             -> 100M
find /tmp -maxdepth 1 -name "spex-*-project-*" -mmin -60   ->   6     ← 近 1 小时新建/修改
                                                  -mmin -10 ->   2     ← 此刻仍在被持续创建
lsof 打开的 fd                                              ->   0
是否登记在 ~/.spexcode/projects.json                        ->   0
```

三格结论:
1. **不是历史残留,是活跃累积** —— 10 分钟内还有 2 个在动。测试每跑一次就铸一个,没有任何东西回收。
2. **因此批量清理不是安全操作**:任一时刻都可能有正在跑的测试持有其中几个,
   而目录名不携带「它属于哪次运行、那次运行还活着吗」这个信息 —— 这本身就是缺口的一部分。
3. **磁盘量(100M)不是问题,CPU 才是** —— 同一族里带着活进程的那几个,今天累计烧掉 116+ CPU 小时,
   并且长期占在一支队伍的 `load < 14` 测试席位闸的分母里。**危害不在残留物,在残留物里那些还在跑的。**

⇒ 可行的最小改进不是「删干净」,而是让夹具**可判定归属与存活**:
目录名或目录内带一枚运行标识(pid / 起始时间 / 测试名),使「列出所有已死夹具」成为一条安全可跑的命令。
现状下任何清理脚本都必须先解决「这个夹具还活着吗」,而那个信息现在无处可读。

<!-- reply: 0edd38cf-8197-44c6-876d-b63410c7ee4f @ 2026-08-06T11:19:21.678Z -->
**更正我自己上一条:我写「『这个夹具还活着吗』那个信息无处可读」——错的。它可读,只是不在目录里,在 `/proc` 里。**

实测(扫 `/proc/[0-9]*/cwd` 与 `/proc/[0-9]*/fd/*`,再叠一条 mtime):
```
有进程占用(cwd 或 fd 指向该夹具)            ->   0
无占用但 60 分钟内有写                       ->   0
三条判据都判死(无 cwd / 无 fd / 60min 无写)  -> 181   ← 全部
```
⇒ **今天就存在一条可跑的「安全删除」判据**,不需要任何产品改动:
`没有任何进程的 cwd 或 fd 指向它` ∧ `近 N 分钟无写`。

两条必须写清的边界,否则这条判据会被误用:
1. **三条信号都不充分,只有合取才成立。** `cwd` 抓不到「进程在别处运行但写这个目录」;
   `fd` 只抓当下打开的;`mtime` 只抓最近写过的。单用任何一条都会误删。
2. **它是时点读数,不是租约。** 判定完成到执行删除之间,新测试随时可能开始用某个夹具。
   ⇒ 正确用法是**判定后立即删**,不是算出一张清单留着以后删。

**所以产品侧的最小改进仍然成立,但理由要换**:不是「无从判断」,而是
**「要靠三条互不充分的外部信号合取、且只在时点上成立」**。夹具自带一枚运行标识(pid / 起始时间 / 测试名)
会把它变成**一条确定信号**,判定从概率性变成确定性,清理也就从「时点抢删」变成可安全排期。

(本次仍未删除任何目录:181 这个数是本 issue 的证据,而 100M 磁盘对该机器不构成压力。
删除会销毁证据,收益为零。)
