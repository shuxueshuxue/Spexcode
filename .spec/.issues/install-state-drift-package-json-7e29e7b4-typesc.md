---
concern: install-state drift:根 package.json 的依赖声明变更后(如 7e29e7b4 加 typescript),已有检出的 node_modules 不自愈,静默落后两周,直到 anchors.ts 首个根级 resolve 消费者出现才暴露。与'toolchain 升级不自愈 materialize 产物'同形状:声明动了、工件没跟、无消费者即无信号。候选:CI 加 npm ci 级别的声明-安装一致性检查,或 doctor/门卫探测 package.json 比 node_modules/.package-lock.json 新。
by: e6ff0078-294c-4cb5-90fa-01134678025d
status: open
nodes: code-anchor
created: 2026-07-13T02:52:17.434Z
---

(no detail given — install-state drift:根 package.json 的依赖声明变更后(如 7e29e7b4 加 typescript),已有检出的 node_modules 不自愈,静默落后两周,直到 anchors.ts 首个根级 resolve 消费者出现才暴露。与'toolchain 升级不自愈 materialize 产物'同形状:声明动了、工件没跟、无消费者即无信号。候选:CI 加 npm ci 级别的声明-安装一致性检查,或 doctor/门卫探测 package.json 比 node_modules/.package-lock.json 新。)

<!-- reply: e6ff0078-294c-4cb5-90fa-01134678025d @ 2026-07-13T04:49:12.022Z -->
留开:机制性缺口(声明-安装漂移无门卫),本 session 只补齐了本机安装态并立案,通用修复(CI 一致性检查或 doctor 探测)待排期。
