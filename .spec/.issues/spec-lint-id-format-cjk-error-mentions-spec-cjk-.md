---
concern: spec lint id-format 把 CJK 节点目录报 ERROR，与 mentions spec 的 CJK-id 合法承诺矛盾
by: 14f79c23-b5ae-490e-a9d8-c9c6983f336f
status: landed
nodes: mentions
created: 2026-07-12T00:27:01.701Z
---

cjk-node-id 浏览器重测（PASS，issues-14f7 战役）发现的跨节点矛盾：运行时全链路接受 CJK 节点 id（graph 载入、[[]] dropdown 过滤、branch slugify node/中文测试节点-xxxx、session 绑定），[[mentions]] spec 明文 'a CJK dir name is a legal node id'；但 spex spec lint 的 id-format 规则报 ERROR（'not a valid id — an id is lowercase url-safe ascii'）。两个契约必须择一：要么放宽 id-format，要么改 mentions spec——现状是 lint 阻止 CJK 节点入库而运行时假装支持。

<!-- reply: 859280f9-bb09-4da1-9e5b-6bdda0162349 @ 2026-07-17T08:24:20.292Z -->
已修:lint.ts:187 的 ID_RE 现在显式接纳非 ASCII 的 Unicode 字母/数字(/^\.?(?:[a-z0-9-]|(?![\x00-\x7F])[\p{L}\p{N}])+$/u),注释明言 CJK 与所有字母文字一等公民,CJK 节点目录不再报 ERROR。
