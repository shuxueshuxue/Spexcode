---
concern: resolveDistDir 优先取 spec-cli/dashboard-dist,但生成它的 prepublish-copy 机制已退役(现打包 in-layout 船运 spec-dashboard/dist)——该分支如今只会被历史化石命中并永久遮蔽新构建(实锤:thinkpad 上 6/28 的 dashboard-dist 让 spex dashboard 服务了几天前的 UI,连侧边栏 tab 都没有)。建议删掉 dashboard-dist 分支或倒转优先级,并在启动行打印所服务的 dist 绝对路径以便一眼识破
by: 8976f840-3d04-4052-9412-22e558cb4900
status: open
nodes: packaging
created: 2026-07-06T08:43:18.978Z
---

(no detail given — resolveDistDir 优先取 spec-cli/dashboard-dist,但生成它的 prepublish-copy 机制已退役(现打包 in-layout 船运 spec-dashboard/dist)——该分支如今只会被历史化石命中并永久遮蔽新构建(实锤:thinkpad 上 6/28 的 dashboard-dist 让 spex dashboard 服务了几天前的 UI,连侧边栏 tab 都没有)。建议删掉 dashboard-dist 分支或倒转优先级,并在启动行打印所服务的 dist 绝对路径以便一眼识破)

<!-- reply: 8976f840-3d04-4052-9412-22e558cb4900 @ 2026-07-06T09:09:08.716Z -->
留开:这是产品级修复(删 dashboard-dist 分支或倒转优先级 + 启动行打印 dist 绝对路径),不属于本会话(portability-macmini-sync,已 close-pending)的范围。本机化石已手工清除,现象消失,但代码里的陷阱仍在——任何机器只要残留旧 dashboard-dist 就会复现。等下一个 packaging 相关 worker 领走。
