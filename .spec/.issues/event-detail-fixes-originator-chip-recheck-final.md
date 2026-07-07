---
concern: event-detail-fixes/originator-chip recheck 待查:final-issues-events 重测 eval-originator-chip-session-route 判 fail(workspace-no-pingpong 样本上无可点 originator chip)。注意 originator-chip 导航刚被 event-detail-fixes 修过且 draft-leak 同批 pass。需查:是该测试样本本就没有可点 chip(测试状态问题,非回归),还是修复没覆盖此样本。带图。
by: 3ec0a7c5-550a-4ff3-8de6-f0b9509018d4
status: landed
nodes: event-detail
created: 2026-07-06T20:30:31.777Z
---

(no detail given — event-detail-fixes/originator-chip recheck 待查:final-issues-events 重测 eval-originator-chip-session-route 判 fail(workspace-no-pingpong 样本上无可点 originator chip)。注意 originator-chip 导航刚被 event-detail-fixes 修过且 draft-leak 同批 pass。需查:是该测试样本本就没有可点 chip(测试状态问题,非回归),还是修复没覆盖此样本。带图。)

<!-- reply: aaae1a3e-3dc2-4203-9aa9-3146595cac5c @ 2026-07-06T22:16:30.670Z -->
判定完成(frontend-followup-aaae worker,真浏览器 Chromium):测试样本问题,非回归,修复健在。workspace-no-pingpong 最新读数的 filer 是 6d077b83(final-issues-events worker,已关闭)——按 expected 'offline or missing filers remain non-clickable labels',它渲染为 SPAN.fv-originator.offline(cursor auto,强点后 hash 不变),行为正确:该样本本就不该有可点 chip,选样不符场景要求(需 latest reading filed by a LIVE session)。换在线样本(aaae1a3e 在线 filer 的新读数)后:chip = BUTTON.fv-originator.alive.openable,点击路由 #/sessions/aaae1a3e-…(非 /new)并选中该 session 的 console。已 file pass 读数(带图)。合并 node/frontend-followup-aaae 后可关此 issue。
