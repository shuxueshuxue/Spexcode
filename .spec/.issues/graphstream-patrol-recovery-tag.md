---
concern: graphStream patrol-recovery 测试是间歇的:两侧对照实验设计 + 成因假设指向已立档的 tag 残留
by: c89038e2-6b56-4b4c-8b4a-4ff4ec2c886e
status: open
nodes: graph-cache
created: 2026-07-30T07:49:44.130Z
---

`spec-cli` 的 `a failed refresh keeps watcher causes through patrol recovery` 是**间歇的**,而不是稳定红:
它多次表现出"单跑通过、全量挂"的签名(我在 Node 24 和 Node 22 上各观察到过)。85c6fed6(git-exec 的
spawn-cause 修复)落地后的那一轮全量它绿了,**但我不认这个功劳** —— 单侧的通过计数分不开"flake 恰好没触发"
和"被顺带治好了"。

## 唯一能分开的实验(设计,免得下一个人重新设计)

**两侧各跑 N 次全量**,不是修复侧跑 N 次:

    85c6fed6^  × N 次全量   ← 修复前
    85c6fed6   × N 次全量   ← 修复后

判据:

    修复前 100% 红、修复后 100% 绿   → 被顺带治好(与 git-exec 同因)
    修复前就时红时绿                  → 与那一刀无关,是独立 flake
    修复后仍偶红                      → flake 且仍在

必须是**全量**,不能是单跑:这条测试的失败条件依赖并发负载,单跑不重现。

这个对照的形状和 [[graph-cache]] body 里那条约束一样:**一个"等于 0"没有对照,可能只是仪器没接上。**

## 一条比"随机 flake"强得多的成因假设

已立档的 `graph-stream-patrol-repair-trigger-tags-repair-t` 说:repair 判定要求 tag 集**恰为** `{patrol}`,
而 (a) 每个 delta 订阅者 connect 都 `fireChanged('full')`、(b) 空 diff 的 rebuild 提前 continue 不清 tags。

**这正好解释"单跑过、全量挂"**:并发负载下订阅者更多 → 残留 `full`/`sessions` tag 更可能 → tag 集不再恰为
`{patrol}` → 判定走偏。也就是说这条测试的间歇性可能**不是测试的问题**,而是那条已知产品缺陷在负载下的显形。

若对照证明"修复前也时绿",应把本条并入那个 issue,而不是单独当 flake 修 —— 修 tag 归属才是根因,让测试变稳
只是把症状按下去。

Spec: graph-stream, graph-cache
