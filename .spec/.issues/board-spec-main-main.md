---
concern: board 上会话行的 spec 变化数在 main 历史整段重写后仍与旧 main 基准吻合 —— 待判定是缓存未失效还是设计如此
by: 9be33950-7166-40fd-8d62-5d3a3390cdf7
status: open
nodes: graph-cache, sessions-core
created: 2026-08-05T06:23:15.231Z
---

Spec: graph-cache, sessions-core

严重度低。先说清已测量的与未证明的,避免把观察当断言。

## 已测量

2026-08-05 用 git filter-repo 整段重写了 main 历史(旧 main 3714f82a5 → 新 main 1e91f7837,重写点之后
5719 条提交全部换 sha)。之后在 dashboard 上,会话行显示的 spec 变化数仍是 ~5 / ~20 这个量级。

同一时刻实测各会话分支相对两个基准的差异(自有 spec 目录差异 / 相对新 main):

  node/http-100-99-97-58-5173-sessions-5819   18 / 401
  node/distill-1abb                           41 / 399
  node/harness-adapter-ac88                    1 / 403

每条分支与新 main 的共同基都是 951ab3d10(重写点之前那条),ahead 5500~5724 / behind 5721。
显示值(~5/~20)与【旧 main 基准】的量级吻合(18/41),与新 main 基准(~400)不符。

## 未证明(这条 issue 要判定的东西)

GET /api/sessions 的行里【没有任何 spec 变化字段】(只有 node=null),所以那个数不是从这个端点来的。
因此"board cache 在历史重写后未失效"只是假设,尚无证据。两种可能都还开着:

1. 缓存未失效:board 重建的失效条件盯 git/spec 变化,但一次整段历史重写没有触发它重算。若如此,
   失效键需要覆盖"提交图被重写"这种情形(例如把 main tip sha 纳入键,或对 merge-base 变化敏感)。
2. 设计如此:每条会话的比较基准在创建时就记录下来了(旧 fork 点),显示的是"相对我自己的基准",
   历史重写后这个基准 sha 已不存在,但显示值仍是上次算出的。那就不是缓存 bug,而是【基准 sha 失效后
   没有可见的降级提示】—— 面板会安静地展示一个基于不存在的提交算出的数字。

判定方法:找出 board 行那个 spec 变化数的实际来源(哪个端点/哪段 fold),看它取的基准是 main tip 还是
会话创建时记录的 base;再看该基准 sha 在重写后是否还能解析。

## 为什么严重度低

整段历史重写是罕见事件,且下一次正常失效触发后数字会自愈。真正的持久风险不在这个数字,而在
"旧 node/* 分支合并进新 main 会带回 5700 条旧提交"那条,已单独通知全部在跑的会话。
