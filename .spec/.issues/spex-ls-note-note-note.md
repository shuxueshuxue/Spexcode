---
concern: spex ls 的 NOTE 列原样打印 note 里的换行，多行 note 会把表格行撑断成两行
by: a1061fec-dbd2-41c2-bbb2-545f29c91cc8
status: open
nodes: state, ls-cjk-width
created: 2026-07-30T07:08:18.522Z
---

在 [[state]] 的 long-note-truncation-transparent 重测里撞到的邻接缺陷，**与那次修复无关、且早于它**，所以没并进 node/session-label-a106 那一刀。

`formatTable`（spec-cli/src/sessions.ts）的 NOTE 单元格是 `trunc(s.note, NOTE_BOARD_LIMIT)`：截宽度，但**不拍平换行**。于是一条多行 note 会把它自己那一行撑断，后面的内容（以及图例）被推到下一行。

隔离 SPEXCODE_HOME、种一条 governed 记录、`spex session park --note $'在等 CI\n第二行会被砍掉'`，然后 `spex session ls`（NO_COLOR）：

```
    STATUS        NODE                   ID       ×   PROMPT                                    NOTE
  ⧖ parked        note cuts probe        note-cut                                               在等 CI
第二行会被砍掉
  key: ● working  ○ idle  ⏻ offline  …
```

第二行 `第二行会被砍掉` 从第 0 列开始，破掉了列对齐；note 越多行，表格越乱。

这不是"切割不透明"那一类（内容该显示多少是另一回事，那条已修），是渲染器把任意 prose 当单行用。修法看起来是一行：NOTE 单元格先取首个非空行再截宽，跟 headline 现在用的 `oneLinePreview` 同一个形状——PROMPT 列已经是这么做的（promptPreview 取首行），所以 NOTE 列是这张表里唯一没拍平的自由 prose 列。

没有顺手改，因为它会改 `spex ls` 的输出，需要自己的读数；而且它不是我那一刀造成的。

<!-- reply: a1061fec-dbd2-41c2-bbb2-545f29c91cc8 @ 2026-07-30T07:18:38.302Z -->
这条**故意留 open**：它早于 node/session-label-a106 那一刀（merge 76cb374a），也不是它造成的。formatTable 的 NOTE 单元格不拍平换行这件事今天仍然如此——落地后未改动一行 formatTable。修它会改 `spex ls` 的输出，需要自己的 A/B 读数，所以不该搭车进一条讲派生优先级和切割透明性的 lane。证据在 [[state]] long-note-truncation-transparent 的 A 读数转录里（隔离 SPEXCODE_HOME + 真 CLI 的原始表格输出，可直接复现）。留给接手的人。
