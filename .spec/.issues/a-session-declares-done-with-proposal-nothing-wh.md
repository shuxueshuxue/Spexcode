---
concern: a session declares done with proposal nothing while its commits sit unmerged on its branch
by: 2c787e87-a0ad-4cae-b1db-aa2f1f922f19
status: open
nodes: stop-gate, session-fail
created: 2026-08-05T18:02:13.912Z
---

Spec: stop-gate, session-fail

**`done` + `proposal: nothing` 是一个合法但空转的终局:活停在分支上,看板显示它完成了。**

同一晚两个不同的 codex worker,同一形态 —— 所以不是个人失误:

| session | 交付物 | 申报 | 结果 |
|---|---|---|---|
| `b7b30ef2` | 2 个 commit 在 `node/…` 分支上(含一条 AST 推导守卫) | `done`,`proposal: nothing` | 不会到 trunk。人工打回后才落成 `8966f1085` |
| `3f72d2a2` | 2 个 commit 在分支上 | `done`,`proposal: nothing` | 同上,已第二次打回 |

## 这是实例 B 的新皮,不是同一条

已立的 `the-stop-gate-enforces-that-a-session-declared-n` 说的是「门强制你**申报**,不强制你的交付物**持久**」——
那条的失效是交付物只存在于 tmux 回滚缓冲或 `/tmp`。

这一条不同:**交付物已经持久了**(commit 在分支上,`git` 里,重启不丢)。坏的是**它到不了 trunk,而且申报本身不说这件事**。
换句话说:

> 门问的是「你申报了吗」,**不问「你申报的东西会不会到达任何人」**。

一个 `done` + `proposal: nothing` 的 session,在看板上和一个真正完成并提了 merge 的 session **看起来一样**。
监督者要发现它,必须自己去数分支与 trunk 的差集 —— 而那正是本晚两次都发生的事(人工发现,不是门发现)。

## 为什么它值得单独修

`proposal: nothing` 本身是**正当状态** —— 一个纯调查、纯复验、纯读数的 session 完成时确实没有东西要 merge。
所以修法**不是**禁止它,而是让这两种情况**不再产出相同的看板事实**:

- 一个 session 有**领先 trunk 的 commit**、却以 `proposal: nothing` 申报 done → 这是可判定的(`git rev-list <base>..<branch>` 非空),
  而且判定所需的一切在申报那一刻都在手边。
- 判定为真时,应当**响亮**:要么门拒绝并说出那句诊断(「你有 N 个 commit 不在 `<base>` 上,`--propose merge` 或说明为什么不提」),
  要么申报成功但看板把它标成**未落地**,而不是与已提 merge 的完成态同形。

判据按仓库既有的形状:**下一个忘了提 merge 的 worker 必须在申报处响亮失败或被响亮标记,而不是安静地显示完成。**
参照 `--base` 那条已经做对的先例(`sessions.ts:2150-2155`:命名不存在的 commit 的 base,在创建任何东西之前就 400 拒绝)——
产品自己在相邻位置已经有「创建前就拒绝一个不成立的入参」的标准,这里缺的是终局侧的同一个标准。

## 边界

- 两个 session 的 commit **都已人工落地或已打回重走**,所以这条 issue 不含未抢救的工作 —— 它是机制项。
- 我没有改门。这条要动的是申报路径的对外契约,该连 fail→pass 一起做。
- 观察到的读数(`proposal: nothing` 与分支领先 trunk 的 commit 数)是本晚实测,不是回溯推断。
