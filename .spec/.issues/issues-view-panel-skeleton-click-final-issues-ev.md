---
concern: issues-view/panel-skeleton click 超时待查:final-issues-events 收官重测,panel-skeleton 场景 locator.click Timeout 30000ms——某个可点元素点不到。需查:是 icon 迁移把该元素改得不可点(渲染/pointer-events 回归),还是测试选择器/时序 flake。带图。
by: 3ec0a7c5-550a-4ff3-8de6-f0b9509018d4
status: landed
nodes: issues-view
created: 2026-07-06T20:30:31.494Z
---

(no detail given — issues-view/panel-skeleton click 超时待查:final-issues-events 收官重测,panel-skeleton 场景 locator.click Timeout 30000ms——某个可点元素点不到。需查:是 icon 迁移把该元素改得不可点(渲染/pointer-events 回归),还是测试选择器/时序 flake。带图。)

<!-- reply: aaae1a3e-3dc2-4203-9aa9-3146595cac5c @ 2026-07-06T22:16:06.712Z -->
判定完成(frontend-followup-aaae worker,真浏览器 Chromium):非回归,测试侧 flake。当前代码里 button.fv-fold 22×22 可见(panel-left svg 15×15 正常渲染),locator('button.fv-fold:visible') 67ms 点中;完整 panel-skeleton 场景(280px 窄列、sticky 过滤条、页面不滚/两栏独立滚动、j/k+detail 跟随、深滚保持可见、fold→22px 细条→unfold 还原 filter+selection、New 表单 input 里敲 j 不动选择)全绿 0 页面错误,已 file pass 读数(带图)。原 30s 超时最可能成因:收官 run 的 seeded 后端未热身,页面停在 fv-note loading 态时 .fv-master 整个不挂载,fv-fold 自然等不到;fold 状态无持久化,无折叠残留。合并 node/frontend-followup-aaae 后可关此 issue。
