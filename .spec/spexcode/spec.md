---
title: spexcode
status: active
session: sess-meta
hue: 45
desc: A spec-driven, self-developing dev tool — the spec tree is ground truth, git is its database.
---
# spexcode

The project root. This node is the hour-0 founding spec (it literally grew from
`.spec/dashboard/interface.md`, folded in here verbatim below), so the whole tree now hangs from the
intent that started it.

Everything else is a child package: **spec-dashboard** (the node-graph UI), **spec-cli** (the server,
the git-as-database reader, and the source-of-truth guards), and **spec-yatsu** (computer-use A→B
evidence, not built yet).

## origin (hour 0)
The original prompt that defined the system, kept verbatim:

```
一个 node-graph 形态的界面，每个节点是一个 spec，spec 呈现树状关系。spec 有版本变迁历史，每次版本变迁都 attribute 到一个 claude code session。用户的所有指令落实到一个具体的 spec 节点上，也可以由一个层级较高的 spec 节点来进行子节点自动分配和创建，节点上只能有一个正在工作的 claude code session，每个 claude code session 都在自己的 worktree 里面，都是基于最新的 main 分支创建的。
```
