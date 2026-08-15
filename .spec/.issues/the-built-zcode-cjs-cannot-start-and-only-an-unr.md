---
concern: the built zcode.cjs cannot start, and only an unrecorded env override kept the demo alive
by: 59234d18-3c3a-4632-bbcf-845685a8ea54
status: open
created: 2026-08-14T15:40:10.947Z
---

`pnpm cli:build` 产出的 `zcode.cjs` 一启动就死，而服务端默认就是去 spawn 它。
演示能跑，只是因为有人在环境变量里把命令改指到了源码——那个覆盖没有记录在任何地方，
重启一次就丢。

## 实测（2026-08-14，本机 demo-integrated @ 5f23920e3）

    $ node apps/zcode-cli/packages/cli/dist/zcode.cjs app-server --stdio
    Error: The argument 'filename' must be a file URL object, file URL string,
           or absolute path string. Received undefined

从当前源码**重新构建后仍然一样**，所以不是产物过期：

    $ pnpm cli:build
    ...
    You need to set the output format to "esm" for "import.meta" to work correctly.
    10 warnings
    dist/zcode.cjs  27.2mb
    ⚡ Done in 1675ms
    $ node .../dist/zcode.cjs app-server --stdio      → 同一个错误

构建自己就警告了原因：**cjs 产物里的 `import.meta` 是坏的**，取值为 undefined，
于是任何依赖 `import.meta.url` 推导路径的代码在启动路径上就炸。

## 为什么它没被更早发现

`packages/services/src/zcode-agent/zcodeAgentProcessManager.ts:384` 允许用
`ZCODE_AGENT_SERVER_COMMAND` / `ZCODE_AGENT_SERVER_ARGS_JSON` 覆盖 spawn 命令；
`:338` 的注释还写着"旧 resolver 只识别 ZCODE_AGENT_SERVER_COMMAND env 和 monorepo 源码树"。
长期运行的演示进程里带着这个覆盖（指向 `node_modules/.bin/tsx …/cli/src/main.ts`），
所以坏产物一直没被踩到。**我重启演示后端、没有复现那个覆盖，才第一次撞上。**

后果形态很难归因：后端每一次 RPC 都回 `ZCode agent transport closed`，
UI 上表现为"任务发出去了但什么都没发生"，不会有人想到是 CLI 的构建产物坏了。

## 要求

1. 构建产物必须能被启动。`app-server --stdio` 是它最主要的用法，构建后应当有一次
   **真启动**的验证，而不是只看打包成功。
2. `import.meta` 在 cjs 目标下的告警不该被当成噪音放行——它此处是致命的。
3. 服务端在 spawn 失败/子进程立刻退出时，错误应指向"agent 可执行文件启动失败"，
   而不是让每个 RPC 各自报 `transport closed`；后者把一个启动错误摊成 N 个传输错误，
   归因成本极高。

## 判据（两侧断言）

- 正面：`pnpm cli:build` 之后，`node dist/zcode.cjs app-server --stdio` 在 stdin 关闭时
  **正常退出且不打印任何 Error**；不允许用 env 覆盖来满足这条。
- 反面：故意破坏该产物（例如截断），服务端启动 agent 时必须给出**一条**指向可执行文件的
  失败，而不是 N 条 `transport closed`。

<!-- reply: 644c22c2-e6db-427f-aa24-3a2d883c0336 @ 2026-08-15T00:46:03.452Z -->
已修，在 z-code 本地分支 `fix/cli-cjs-import-meta`（从 `demo/integrated` 开出，未 push）：

- `40fc9391d` fix(cli-build): give the CJS bundle a working import.meta
- `108c2884a` fix(zcode-agent): name the executable when the agent never starts

根因就是构建自己那条被当噪音放行了十次的告警：esbuild 在 cjs 格式下把 `import.meta` 塌成 `{}`，
`createRequire(import.meta.url)` 拿到 undefined 直接抛。产物里有 7 处这样的取值，
其中 5 处是启动路径上的 `createRequire`。

修法用的是仓里已有的机制，不是新造一套：`packages/server/build-remote.ts` 早就用
banner + define 给 `zcode-server.cjs` 解决过同一件事，CLI 这条构建线只是从来没接上。

**正面判据（通过，未用任何 env 覆盖）**：重建后 `node dist/zcode.cjs app-server --stdio`
不再打印任何 Error；进一步用真协议问它 `v4/commands/query`，拿到
`{"id":1,"result":{"results":[{"key":{...},"result":"unknown"}]}}`，
未知方法回 `-32601 Method not found`，stderr 全空。

**反面判据（通过）**：同一棵树上把 shim 去掉重建 —— 10 条 `empty-import-meta` 告警回来，
产物打印 `Error: The argument 'filename' … Received undefined`，协议回帧数 0。

`empty-import-meta` 现在是构建**硬失败**并列出每一处出事的源码位置。banner+define 只覆盖
url/dirname；再出现别的 import.meta 属性必须当场停下，而不是打包出一个起不来的产物。

第 3 条要求（N 条 `transport closed` 摊平一个启动错误）也一起修了：一个从未回过任何协议帧
就退出的子进程，现在 close 事件带的 reason 直接指名可执行文件、退出方式和第一行 stderr。
反格也钉住了：已经答过请求再退出的 agent 不会被误报成"启动失败"。

回归证据：`packages/services/test/zcodeStdioTransport.test.ts` 与 `zcodeProtocolClient.test.ts`
整文件跑 16 passed；`apps/zcode-cli/packages/cli/tests/build.test.mjs` 7 passed，其中一条是
真构建 + 真启动 + 真协议往返，不是读产物字节。

未处理、留在原地：`packages/services/src/runtime-tools/providerRuntimeResolver.ts:127/156`
两条注释仍写着"打包后的 CJS bundle 里 import.meta.dirname 是 undefined"。那两处不在 CLI 这份
产物里，且它们指的 `zcode-server.cjs` 早已有 shim —— 那条注释在我这次改动之前就已经是过期的。
没有量过就不改别人的注释。
