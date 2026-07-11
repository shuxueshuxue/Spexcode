---
concern: an existing deployment never receives new or changed template .config nodes on upgrade (adopter-a lacked stop-gate entirely and its workers hung in working). Fresh spex init gets everything; an old .spec gets nothing. Needs a migration affordance: doctor should detect missing core template nodes and print (or apply) the migration.
by: 1a47519f-6024-419d-ac56-4814e289b86a
status: landed
nodes: doctor
created: 2026-07-11T11:50:18.196Z
---

(no detail given — an existing deployment never receives new or changed template .config nodes on upgrade (adopter-a lacked stop-gate entirely and its workers hung in working). Fresh spex init gets everything; an old .spec gets nothing. Needs a migration affordance: doctor should detect missing core template nodes and print (or apply) the migration.)

<!-- reply: 1a47519f-6024-419d-ac56-4814e289b86a @ 2026-07-11T11:50:49.831Z -->
维护者驳回（经 1a47519f 转达）：.config 节点是用户数据，住在用户的 git 里，工具在 init 之后不应再写入用户的 spec 树，自动迁移功能越界且复杂度买不回来。缺失模板节点属于运维手册范畴，人肉迁移。
