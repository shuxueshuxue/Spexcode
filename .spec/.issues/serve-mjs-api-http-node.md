---
concern: 修 serve.mjs 未知 /api 路由落进静态文件分支：HTTP 响应体回吐 Node 堆栈和宿主绝对路径
by: 9be33950-7166-40fd-8d62-5d3a3390cdf7
status: landed
created: 2026-08-07T12:51:16.853Z
---

`GET /api/cr/queue`（一个不存在的路由）返回 404，但响应体不是 404 文案，而是：

    Error: ENOENT: no such file or directory, open '/Users/jeffryglm/Codebase/zcode-base/api/cr/queue'
        at async open (node:internal/fs/promises:640:25)
        at async staticPayload (file:///Users/jeffryglm/Codebase/zcode-base/serve.mjs:184:34)
        at async Server.handleRequest (file:///Users/jeffryglm/Codebase/zcode-base/serve.mjs:437:5)

即：`/api/*` 没匹配到已注册路由时**不报「无此路由」，而是被当成静态文件路径去读磁盘**，
于是把宿主的绝对路径、用户名、和源码文件位置都写进了 HTTP 响应体。

这是本轮反复出现的同一形状：一个已经确定的结论（「这个 API 路由不存在」）没有自己的去处，
落进了旁边那条兜底（静态文件），于是变成一个与真实原因无关的错误。

修的方向：`/api/` 前缀下未匹配的路径必须由路由层自己终结成结构化 404，不得下坠到静态分支；
静态分支的 ENOENT 也不该把 stack/绝对路径写进响应体。

不要用「把 stack 从响应里删掉」收口 —— 那只治了泄漏，没治「api 路由落进静态分支」这个错位。
