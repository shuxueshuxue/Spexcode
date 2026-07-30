---
concern: agent 读不到自己的 headline：写 note 的那一方是唯一没有观测手段的一方,所以'note 没进链'这类缺陷对受害者不可发现
by: a1061fec-dbd2-41c2-bbb2-545f29c91cc8
status: open
nodes: session-label, state, cli-surface
created: 2026-07-30T06:52:05.178Z
---

由 c89038e2 本人提出（它就是 [[session-label]] board-headline-pane-session-parked-session 那个现场）。它读到修复说明后回了一句：

  「我以为 note 是我对外的通路，写了 2127 字符。deriveHeadline 里没有 note 这一项，这个我自己无从发现：**agent 看不见自己的 label**。」

**结构性盲区：这类缺陷的受害者恰好是唯一没有观测手段的那一方。** 它写 note 是在正确使用一条它以为存在的通路，而产品从不告诉它那条通路通到哪里去了。派生优先级已经修好（headline 现在收 note），但下一个同类错误——把重要的话写进一个当前不被任何一行显示的字段——仍然对写它的 agent 不可发现。

**实测的当前状态（2026-07-30，HEAD 7979c1f9 之后，本机 CLI 逐个跑过）：**

- `spex session ls`（文本表）：NODE 列 = **label**，没有 headline 这一列。agent 在人可读的表里看不到任何 headline，自己的或别人的都看不到。
- `spex session show <self>`：标题行 = **label**（`deriveLabel`），逐字段列出 status/node/branch/launcher/worktree/created/note/proposal/prompt——**没有 headline**。
- `spex session ls --json`：`headline` 和 `label` 都在。所以数据是够的，但只在 JSON 里，而且没有任何东西标出哪一行是"你"。
- `spex session watch` 的问候语：用 **headline** 命名 *watcher*，然后把这句发给被观察的 session。
- reply-channel footer：用 **headline** 命名 *sender*，给接收方看。

最后两条是这个盲区的形状：**headline 唯一被渲染成人话的两处，说的都是别人。产品会告诉 B 关于 A 的事，从不告诉 A 关于 A 的事。**

两个候选形状（未实现，按代价排序）：

1. **声明回执里点明 note 落到哪。** `spex session done/park/ask` 的回执已经在教一次 note 的截断（"your note is 856 chars; the session table shows only the first 50…"，[[state]] 的 truncation transparency 规则）。修完 headline 之后，note 的**第一行**又多了一道 60 列的显示切割，而回执没提。按 [[state]] 自己那条"切割必须对作者透明"的规则，这条透明性现在是欠着的——而且它恰好落在一个已经为此存在的表面上，代价近乎零。
2. **给 self 视图一行 headline。** `spex session show` 加一行 `headline : <derived>`（并且标出 label 是 label），或者在 `spex session ls` 里标出自己那一行。这样"我在看板上长什么样"这个问题有了一个可读的答案，而不必让 agent 去解析 JSON 并自己认出哪一行是自己。

**为什么没塞进 session-label 那一刀（我，a1061fec，判断）：** 那一刀的承诺是"派生里哪一格胜出"——一个函数内的优先级，用 board 行的浏览器读数度量。这一条的承诺是"派生值对它的主体可观测"，改的是 CLI 文本表面（`session show` / `session ls` / 声明回执），属于 [[cli-surface]] / [[state]]，度量也不同（cli 标签，不是 frontend-e2e）。两者都不动"唯一派生点"这条契约。合起来会让那一刀跨两类承诺，所以照 c89038e2 那条 lane 的先例拆两步。

候选 1 可以论证是 session-label 这次改动欠下的（是我的改动创造了那道新的 note 显示切割），代价也小；如果人类要求，它可以作为紧接的第二刀单独落，不必和候选 2 绑在一起。
