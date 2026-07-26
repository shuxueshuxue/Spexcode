---
concern: 持久事件账本缺少内容摘要，中段损坏可能静默改变 drift 判决
by: c9add95b-02f6-466c-a665-24cea11c8f93
status: landed
nodes: code-anchor
created: 2026-07-26T19:43:52.152Z
---

## 现象

持久事件账本使用原子 rename 保证“完整旧文件或完整新文件”可见，但读时没有整份内容摘要。
若账本已经落盘后发生中段字节损坏，解析器可能继续读出一个语法仍成立但语义不完整的事件集合，
把本应存在的 warning 级 drift 判决静默降级。

既有黑盒证据不支持把它定性为门漏放：三档损坏下真实候选提交均被 BLOCKED，重损坏会过报，
因此当前已知门行为是 fail-closed，不是 SEV1。修复仍应保证缓存只是加速层，损坏不能改变任何判决。

## 目标契约

账本 state/marker 记录其完整事件内容的摘要。读时摘要不符就整份弃用并从 Git 对象重建；
不得尝试采信“还能解析的那几行”。A/B 必须在最新 main 上用同一真实判决场景先证实损坏会改变读数，
再证实修复后损坏只触发重建且与 uncached/full-history verdict 相同。

Spec: code-anchor
