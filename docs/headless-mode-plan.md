# 无头模式(launcher 双指令)实现方案

> 状态:设计稿,待人审。产出自 2026-07-17 的调查会话(session 2ca5303c):mbp/z-code 手搓
> `codex-spex-exec` 无头 launcher 的机制剖析与双跑实证、claude `-p` 下 stop-gate 闭环实测、
> dashboard 手机端 timeline 通道盘点。

## 0. 目标、非目标、原则

**目标**:每个 launcher 可显式携带两条完整指令——`cmd`(有头/交互 TUI)与 `headlessCmd`(无头/一次性 turn);创建会话时在 popout 或 CLI 上选模式;无头会话的 console 用 timeline 聊天视图替代 terminal;hooks/状态机/Session trailer/eval 纪律在两种模式下等效工作。

**非目标**:不改 hook 体系(已实证两模式通用);不改 timeline 数据面(已建成);不为 pi/opencode 实现无头(接口留位,能力为 null);不做 headless 默认化(`sessions.defaultMode` 留座,默认仍 interactive)。

**三条原则**(来自调查实证的教训):

1. **指令是整体**:两条 cmd 都由配置作者一字一句写全,系统对其内部零解析零改写(唯一保留的既有接缝是 codex 取首 token 派生 app-server 命令,`harness.ts:406`)。
2. **杜绝双跑**:codex 的无头执行体在 app-server 侧,pane 永不再跑第二个 agent(mbp 事故的结构性修复:rollout 实录显示任务 prompt turn 与 pane 的 "Continue…" turn 在 0.8s 内先后点火、并行执行 34 分钟、双份 task_complete)。
3. **无 if(harness)**:模式差异全部落在 adapter 能力对象上,产品代码只按 `mode` 选 ops,不认 harness。

## 1. 配置 schema(`spexcode.json` / `spexcode.local.json`)

```jsonc
{ "sessions": {
    "launchers": {
      "reclaude": {
        "harness": "claude",
        "cmd":         "/home/j/.local/bin/reclaude --dangerously-skip-permissions",
        "headlessCmd": "/home/j/.local/bin/reclaude --dangerously-skip-permissions -p"
      },
      "codex": { "harness": "codex", "cmd": "codex --yolo" }   // 无 headlessCmd 也可开无头档(§5)
    },
    "defaultLauncher": "reclaude",
    "defaultMode": "interactive"        // 新增,可选;"headless" 时 popout/CLI 默认落无头档
} }
```

规则:

- `cmd` 语义不变 = 有头指令,**存量配置零迁移**。
- `headlessCmd` 可选;空串视同缺省。校验发生在**使用时**(fail-loud):`--headless` 落在一个 `headlessNeedsCmd=true` 且无 `headlessCmd` 的 launcher 上 → 创建请求 4xx/CLI 报错,信息指向 `spex guide settings`。
- `guide settings` 的 LAUNCHERS 一节(权威手册)同步补两字段的文档与示例。

## 2. 后端:类型与解析层(`spec-cli/src/harness.ts`)

### 2.1 Launcher 类型与解析

- `Launcher`(`harness.ts:1266`)扩为 `{ name, harness, cmd, headlessCmd: string | null }`。
- `launcherList()`(`harness.ts:1272`)透传 `headlessCmd`,并为每项计算 **`modes: string[]`**(见 §7 settings payload)——可用性判定属于后端(adapter 知识不外泄给前端)。
- `resolveLauncher()`(`harness.ts:1300`)返回扩展后的对象;不做 headless 校验(校验在 create 时结合 mode 做)。

### 2.2 Harness 接口:headless 能力对象

在 `Harness`(`harness.ts:42`)增加一个成员,镜像 `agentDir` 的"null = 无此原语"模式:

```ts
export interface HarnessHeadless {
  // 该 harness 的无头形态是否需要一条 agent 指令(claude true;codex false —— 执行体在 app-server 侧)
  needsCmd: boolean
  // pane 内的启动脚本(cmd 整体嵌入,永不解析)。claude:一次性 -p 进程;codex:只读 follow/占位
  launchCmd(id: string, runtimeDir: string | undefined, cmd: string | undefined): string
  // turn-scoped 判活(§4.3/§5.3)
  liveness(rec: SessRec, tmuxAlive: boolean, runtimeDir: string, pane: PaneProbe, socketLive?: boolean): Liveness
  // 无头投递(§4.4/§5.4)
  deliver(rec: SessRec, text: string): Promise<DispatchResult>
  // reopen 语义(§4.5/§5.5)
  resumeArg(rec: SessRec): string
}
// Harness 增加:
readonly headless: HarnessHeadless | null   // pi/opencode 先给 null
```

`sessions.ts` 各调用点的路由统一为一行:`const ops = rec.mode === 'headless' && h.headless ? h.headless : h`——这是 mode 分支(产品概念),不是 harness 分支,合规。

## 3. 后端:创建、记录、pin(`spec-cli/src/sessions.ts`, `index.ts`)

### 3.1 记录字段

- `SessRec`(`sessions.ts:229`)与 raw 读写(`:254`/`:280`)增加 `mode: 'interactive' | 'headless'`;**老记录缺省读作 `interactive`**(与 `harness||'claude'` 同法,`:254`)。
- pin 规则(`newSession`,`sessions.ts:1215-1219`):
  - `mode` = 请求值 ?? `sessions.defaultMode` ?? `'interactive'`;
  - `launchCmd` pin **选中模式那条指令**:headless 且 `needsCmd` → `chosen.headlessCmd`(缺失即 fail-loud);headless 且 `!needsCmd`(codex)→ 仍 pin `chosen.cmd`(app-server 二进制派生要用,`codexBinary`);interactive → `chosen.cmd`。resume-launcher-pin 机制(`:954-962`)原样生效——**resume 永远重放创建时那条指令与模式**。
- `Session` 视图行(`:588`)与 `/api/sessions/:id` 详情增加 `mode`。

### 3.2 API

- `POST /api/sessions`:body 增加可选 `mode`;`createSession`/`newSession` 签名(`sessions.ts:1147/1183`)透传。校验非法值 400。
- 创建路径上的能力校验:harness 无 `headless` 能力而请求 headless → 400,消息含 harness 名与支持清单。

### 3.3 CLI(`spec-cli/src/cli.ts`)

- `spex session new "<task>" --headless`(等价 `--mode headless`;`--mode interactive` 显式覆盖 defaultMode)。
- `spex session ls / show / review`:行尾/详情标注 `◇`(headless);`--json` 带 `mode` 字段。
- `spex help session` 与 `spex guide settings` 文案更新。

## 4. claude 无头适配(`claudeHarness.headless`)

### 4.1 launch

- pane 内执行:`SPEXCODE_SESSION_ID=<id> exec <headlessCmd> --session-id <id> '<prompt>'`。
  - `--session-id` 与 prompt argv 与今天交互式同法(调用方追加尾巴,`sessions.ts:1050`);cmd 整体嵌入。
  - **env 差异**:不注入 `CLAUDE_BG_BACKEND` / `CLAUDE_BG_RENDEZVOUS_SOCK`(`rvEnv`,`sessions.ts:84-95` 按 mode 旁路)——无头不需要 rendezvous daemon,也不假装有。
- **launch.sh 模板差异**(`sessions.ts:985-998`):现有"快退→重试"循环假设*快退=失败*,对一次性 `-p` 进程是错的(小任务快退=正常完成)。headless 模板:**exit 0 = 完成,非零 = 失败**(打印 rc,不重试或仅对非零有界重试);去掉 readiness 等待。
- `waitForReady`(`sessions.ts:1278-1287`):headless 下改判"窗口起 + pane 树里出现 claude 进程"或"记录状态离开 launched"(hooks 已实证会推),不等 socket。

### 4.2 hooks / 状态机 —— 零改动

已实证(scratch 项目 + governed record + `reclaude --session-id <uuid> -p`):`-p` 模式 mark-active 照翻、**stop-gate `decision:block` 照样逼出续跑**、agent 声明落记录(`status: asking`, note 落地)、exit 0。`Notification`(idle)/`StopFailure` 不触发——照 codex 先例视为该形态不存在的事件,不补。

### 4.3 liveness(turn-scoped)

- online(working)⇔ 窗口在 **且** pane 后代树里有 claude 进程(复用 codex 的 legacy 树扫实现,`sessions.ts:322-339` 一族;匹配 `claude*|node*`)。
- 进程退出后:**记录的 declared status 为准**(stop-gate 保证非崩溃退出必有声明)。窗口在、无进程、状态仍 `active/working` → `offline`(诚实:崩了或被杀)。
- `paneTitleIsSelfSummary` 对 headless 读 false(headline 走 prompt 预览回退,`sessions.ts:489-491` 现成)。
- **occupancy 语义变化(明示)**:`OCCUPIES_SLOT`(`sessions.ts:1023`)按 liveness 计,无头会话 turn 间隙不占 `maxActive` 槽——并发容量实际变大。按现规则自然得出,不特判;在 spec 里写明这是有意行为。

### 4.4 投递(`spex session send` / POST input)

- 前置:turn-scoped liveness 为 online(上一 turn 未完)→ **拒绝并说明**(fail-loud;同一 claude 会话并发两个 `-p --resume` 是未定义行为)。空闲 → 向该会话 tmux pane(退回 shell 提示符状态)注入一行:
  `exec <pinned launch_cmd> --resume <id> '<msg>'`(经与 launch 同源的脚本模板,非裸 send-keys 拼接;`deliveryBlockedBy` 无 TUI 恒不适用,跳过)。
- 确认层级:进程成功起跑 = delivered(hooks 的 UserPromptSubmit/mark-active 会立即把记录推回 active,timeline 照录 `sent` 行——`superviseTimeline` 观察 store,不关心投递通道)。
- merge-dispatch(manager 把 merge 派回会话)走同一条路,无特例。

### 4.5 resume/reopen

- reopen 不再是"把 TUI 拉回来":headless 会话的续命**就是下一次投递**。`resumeArg` 返回空;`spex session resume` 对 headless = 确保窗口存在 + 提示"用 send 继续"(不伪造 prompt——mbp wrapper 的 "Continue and complete…" 教训:**系统永不替人类/管理者编造指令**)。

## 5. codex 无头适配(`codexHarness.headless`)

### 5.1 launch

- 复用 `codexLaunchCommand`(`harness.ts:428-502`)全部逻辑——app-server 起停、mkdir 锁、`codex-launch` thread/start + 首 turn + rollout 等待、`harness_session_id` 落记录——**唯一差异:最后一行 `exec ${codexCmd} --remote … resume "$tid"` 不执行**,替换为只读占位(v1:`printf 'headless thread %s — 会话视图见 console' "$tid"; exec tail -f "$log"` 或直接长睡)。`needsCmd:false`,`headlessCmd` 不参与;app-server 二进制仍由 pinned `cmd` 首 token 派生(版本同源不变量,`harness.ts:395-405`)。
- **双跑从结构上不可能**:pane 里没有第二个 agent 进程可言。

### 5.2 hooks —— 零改动

hooks 本就从共享 app-server 进程触发(spec 已验证:shim 在主 checkout `.codex/hooks.json`,thread 维度经 `harness_session_id` 别名解析),与 pane 无关。mbp 生产两会话即为实证。

### 5.3 liveness

- 目标态:`thread/read { includeTurns }` 问 app-server——`inProgress` turn 存在 → working;idle → 以 declared status 为准;app-server socket 死 → offline。实现为每 snapshot 一次的批量 JSON-RPC 探测(与现有 `rendezvousListening` 批探同位,`sessions.ts:435-441`),短超时 + 结果缓存。
- v1 降级路径(若 0.144.x 的 thread/read 形状需再验):app-server socket 活 + 记录状态驱动;spec 里标注为过渡。

### 5.4 投递 —— 零改动

`turn/steer` / `turn/start` 走 app-server(`harness.ts` 既有实现),本就不依赖 pane。

### 5.5 resume/reopen

- thread 与 rollout 持久,无进程可"拉回";同 claude:reopen = 确保窗口(若保留)+ 提示走 send。

## 6. 前端:popout(`spec-dashboard/src/launch.js`, `SessionInterface.jsx`, `MobileApp.jsx`)

### 6.1 数据

- `useLaunchers`(`launch.js:53`)增加 `mode` 状态:`localStorage 'si.mode'`(与 `'si.launcher'` 并列,`launch.js:54-55`);`pickMode(m)` 同法持久化。
- `/api/settings` 每个 launcher 行带 `headlessCmd` 与 `modes`(如 `["interactive"]` 或 `["interactive","headless"]`);前端**只消费 modes,不推理能力**。
- `createSession(prompt, launcher, mode)`(`launch.js:35-39`)body 增 `mode`。
- 选中组合非法(记忆的 launcher 在记忆的 mode 下不可用)→ 回落 interactive 并即时提示,不静默换 launcher。

### 6.2 LauncherPicker(`SessionInterface.jsx:79-130`)

- pop 卡片**顶部一个 segmented 开关**:`⌨ 有头 | ◇ 无头`(i18n:`session.modeInteractive` / `session.modeHeadless`,zh/en 双份;aria-pressed;键盘左右切换)。
- 行内 cmd 明文**随开关切换**:interactive 显示 `cmd`;headless 显示 `headlessCmd`,codex 类(`needsCmd:false`)显示占位文案"服务端执行,无独立指令"(i18n `session.headlessServerSide`);当前模式下不可用的行 `disabled` + 灰显,tooltip 指向 spexcode.json(沿用 `session.launcherTip` 的措辞惯例)。
- pill 触发按钮(`:93-104`):harness 徽标 + 名字,headless 时右侧加小号 `◇`(有头不加噪)。
- `MobileNewSession`(`MobileApp.jsx:253-299`)共享同一 hooks,渲染同一开关(触摸尺寸)。

### 6.3 会话 console 视图选择

- 抽取共享组件 **`TimelineChat.jsx`**:即 `MobileSessionDetail`(`MobileApp.jsx:120-244`)的时间线聊天体(8s 轮询 `GET /api/sessions/:id/timeline` + board 推送触发即时刷新 + 发送后刷新),`MobileSessionDetail` 改为其薄包装。
- `SessionInterface.jsx:851` 挂载点按会话 `mode` 分派:interactive → `SessionTerm`;headless → `TimelineChat`。Tab 文案 Terminal→Chat(headless 时);Eval tab 不动。
- headless 的发送一律带 `replyVia:'note'`(与 mobile 相同,`MobileApp.jsx:148`;后端 `index.ts:513-514` 现成)。
- board 会话行加 `◇` 模式标(与 harness 徽标并列,`harness.jsx` 词汇表加一枚)。

## 7. API 变更汇总

| 面 | 变更 |
|---|---|
| `GET /api/settings`(`index.ts:178-180`) | launchers[] 增 `headlessCmd`, `modes`;顶层增 `defaultMode` |
| `POST /api/sessions` | body 增可选 `mode`;非法/不可用 → 400 带因 |
| `GET /api/graph` / `GET /api/sessions/:id` | 会话行/详情增 `mode` |
| 其余(timeline/input/socket/evals) | 零变更(socket 对 headless 会话仍可连——pane 里是占位进程,调试后门保留) |

## 8. 兼容与迁移

- **老记录**:无 `mode` 字段 → 读作 interactive,全部路径不变。无 doctor 迁移。
- **老配置**:零迁移;`headlessCmd` 纯增量。
- **舰队**:随常规发版走(supply chain A/B 不变);gugu/z-code 想启用只需在 `spexcode.local.json` 加一行 `headlessCmd`。
- **mbp 手搓件退役**(落地后):删 `codex-exec`/`codex-worker` 两个 launcher、删 `~/.local/bin/codex-spex-exec`、`defaultLauncher` 回 `codex`(或留 `reclaude`);已跑的旧会话不受影响(pin 机制)。
- 风险回滚:mode 全链路是增量字段,回滚 = 不发 `--headless` 即回到现状。

## 9. 测试与评测计划(按四纪律)

**已有实证(可直接归档)**:① claude `-p` + governed record 的 stop-gate 闭环(2026-07-17 scratch 探测,active→asking + note 落地,exit 0);② codex exec 全生命周期(mbp 生产,含双跑病理 rollout 时间线——恰是 codex 侧"pane 不得跑 agent"设计的 A 面证据)。

- **单元**:`resolveLauncher` 双指令解析/缺省;launch 脚本模板(headless 无重试、无 rvEnv)快照;mode pin 与老记录回退(`harness.test.ts` 惯例)。
- **后端 YATU**(真实高层 API):ThinkPad 起 throwaway backend(`PORT=<free>`, `env -u SPEXCODE_API_URL`),`spex session new --headless` 派真实小任务 → 断言:记录 `mode`、状态流 `launched→working→(declared)`、timeline 行、commit 带 `Session:` trailer、`send` 续 turn、merge-dispatch 走通。claude 与 codex 各一遍(本机 codex 0.144.3 + sub2api 可用)。以 `--result` transcript 归档。
- **前端 YATU**(真实浏览器):popout 开关切换/灰行/pill `◇` → `--image`;console chat 视图(发消息→note 回复渲染,动态)→ `--video`。**浏览器会话用完必收**(2026-07-17 mbp 发烫教训:agent-browser 任务结束 `close --all`)。
- **eval 场景落点**:`launcher-select` eval.md 增 `mode-toggle` 场景;`session-console` eval.md 增 `headless-chat-view`;`harness-adapter`(或新子节点)增 `headless-lifecycle-claude` / `headless-lifecycle-codex` 后端场景。交互路径各跑一遍冒烟防回归。

## 10. spec 工作分解与派工

节点(均已存在,除注明):

- `…/lifecycle/launch/launcher-select` — schema/解析/pin/API/CLI(§1-3, §7)
- `…/sessions/harness-adapter` — `HarnessHeadless` 接口 + claude/codex 实现(§2.2, §4, §5);如体量大,立子节点 `headless-ops`
- `…/sessions/sessions-core`(或 lifecycle 相应节点)— mode 路由、liveness/occupancy 语义(§4.3, §5.3)
- `…/dashboard-ui/session-console` + `…/dashboard-ui/mobile-ui` — TimelineChat 抽取与视图分派(§6.3)
- `session-timeline` — 零改动,related 注记即可

Worker 划分(W1 先行,余四并行):

| worker | 任务 | 依赖 |
|---|---|---|
| W1 | launcher schema + mode pin + API/CLI 面(含 settings payload) | — |
| W2 | claude HeadlessOps(launch 模板/liveness/deliver/resume)+ 后端 YATU + eval | W1(接口) |
| W3 | codex HeadlessOps(去 attach/thread-read 探活)+ 后端 YATU + eval | W1(接口) |
| W4 | popout 模式开关 + pill/行态 + mobile 复用 + 浏览器 eval | W1(API 形状) |
| W5 | TimelineChat 抽取 + console 分派 + replyVia + 浏览器 eval | W1 |

W1 的 `HarnessHeadless` 接口定义即是 W2/W3 的合同,W1 merge 后四路全并行;冲突面(harness.ts 被 W2/W3 同触)由 git 序列化,重合并即可。

## 11. 开放问题(建 node 前定夺)

1. **codex thread/read 探活的版本锚**:app-server RPC 形状按 codex-rs 0.142.x 逆向锚定,舰队已 0.144.3——W3 首任务是对 0.144.3 重验。
2. **headless 会话要不要 tmux 窗口**:方案取"保留"(占位进程;close/终端后门/窗口生命周期语义统一,成本≈0)。若取"无窗口",W2/W3 的 liveness 与 close 路径要改走无窗分支,复杂度略升。
3. **投递忙时策略**:方案取"拒绝 + 明示"(claude);如要排队语义,得给记录加 pending-inbox,建议二期。
4. **`defaultMode: headless` 何时翻**:建议等 W1-W5 全绿 + 一轮 dogfood(spexcode 自身用无头跑若干真实 node)再翻,单独一个小 node。
