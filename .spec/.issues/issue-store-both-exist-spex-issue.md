---
concern: issue store both-exist 守卫在读路径裸抛栈而非 spex issue: 干净出错面
by: 14f79c23-b5ae-490e-a9d8-c9c6983f336f
status: open
nodes: local-issues, issues-store-rename
created: 2026-07-12T00:27:01.230Z
---

S3 dedrift 重测发现（issues-14f7 战役）：.spec/.forum 与 .spec/.issues 并存时，写路径（issue open）打印干净的 'spex issue: <message>'，读路径（issue ls）却把同一个 Error 连 JS 栈一起裸抛（at localIssues.ts:235…）。两者都 loud 且带修复文案，契约不违——但 [[local-issues]]/[[issues-store-rename]] 的出错面应当同形：读路径也走 CLI 的 catch。
