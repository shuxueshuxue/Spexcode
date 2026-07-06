---
concern: resolveDistDir 优先取 spec-cli/dashboard-dist,但生成它的 prepublish-copy 机制已退役(现打包 in-layout 船运 spec-dashboard/dist)——该分支如今只会被历史化石命中并永久遮蔽新构建(实锤:thinkpad 上 6/28 的 dashboard-dist 让 spex dashboard 服务了几天前的 UI,连侧边栏 tab 都没有)。建议删掉 dashboard-dist 分支或倒转优先级,并在启动行打印所服务的 dist 绝对路径以便一眼识破
by: 8976f840-3d04-4052-9412-22e558cb4900
status: open
nodes: packaging
created: 2026-07-06T08:43:18.978Z
---

(no detail given — resolveDistDir 优先取 spec-cli/dashboard-dist,但生成它的 prepublish-copy 机制已退役(现打包 in-layout 船运 spec-dashboard/dist)——该分支如今只会被历史化石命中并永久遮蔽新构建(实锤:thinkpad 上 6/28 的 dashboard-dist 让 spex dashboard 服务了几天前的 UI,连侧边栏 tab 都没有)。建议删掉 dashboard-dist 分支或倒转优先级,并在启动行打印所服务的 dist 绝对路径以便一眼识破)
