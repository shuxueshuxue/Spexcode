<img src="docs/sdd-tuxedo-pooh.png" alt="写代码 vs. 维护一份活的、可执行的规格文档" width="420">

# SpexCode

把 AI agent 纳入回路的 spec 驱动开发。SpexCode 在你的 git 仓库里维护一棵带版本的 spec 树,把每个
spec 和它管辖的代码链接起来,并运行一个会话管理器,把 coding agent 派进相互隔离的 worktree。你负责
review 和 merge;工具负责让意图和实现不分家。

[English](./README.md) | 中文 · 文档:[spexcode.net](https://spexcode.net) · License: MIT

## 模型

一个 spec 节点就是 `.spec/` 下的一个目录,里面有一个 `spec.md`:frontmatter(title、status、
声明管辖文件的 `code:` 清单)加一段正文,描述系统这一部分当前应该做什么。节点可以嵌套,所以这棵树
对应你对项目的理解方式,而不是文件布局。正文本身有两个 owner:很短的人写 **raw source**(意图,
改它需要人),和 agent 写的 **expanded spec**(对意图的详细展开,自由迭代,但必须始终和 raw
source 一致)。

<img src="docs/readme-node.png" alt="看板上的一个 spec 节点:人写的 raw source、agent 写的 expanded spec、DRIFT 徽章,以及它管辖的文件">

三条规则让这套东西成立:

1. **git 就是数据库。** 没有第二份存储。节点的版本号是碰过它 `spec.md` 的 commit 数;历史视图就是
   这个文件的 `git log`;每一版通过 `Session:` commit trailer 归属到写它的那个 agent 会话。看板是
   git 之上的一个读取时聚合器。
2. **正文是活文档。** 永远描述当前意图,原地重写。spec 正文里禁止出现 changelog 标题(linter 强制),
   历史 git 已经记了。
3. **spec 和代码一起落地。** 一次改动就是一个 commit,同时更新 `spec.md` 和它所解释的代码。代码悄悄
   偏离 spec 是唯一被禁止的动作。

按优化过程来读:spec 定义目标,yatsu 的测量给出当前行为离目标多远,commit 推着代码逼近目标。

## 快速开始

需要 Node ≥ 22 和 git。这一步是普通工具,还不涉及 AI。

```sh
npm i -g spexcode        # 安装 spex 命令
cd your-repo
spex init                # 生成 .spec/、安装 git hooks、渲染 agent 契约
spex serve               # API 后端,:8787
spex dashboard           # 看板 UI,:5173,代理到后端
```

`spex init` 是增量式的,在任何已有 git 仓库上可用,不会覆盖你的文件:生成根节点
`.spec/project/spec.md`、一份起始 `spexcode.json`、pre-commit hooks,并向 `CLAUDE.md`/`AGENTS.md`
写入一个托管块,让任何在这个仓库里工作的 agent 自己发现这套工作流。

然后把树长起来:

1. 编辑 `.spec/project/spec.md`,描述项目。
2. 给想管辖的部分加子节点,每个带一个指向现有文件的 `code:` 清单。
3. 跑 `spex lint`。coverage 警告列出还没有 spec 认领的源文件,那就是你的接入 TODO。

这些不需要你全部手写。预期的用法是让 agent 完成大部分 spec 写作;`spex guide spec` 会打印它需要的
确切文件格式。完整的安装过程见文档站的
[getting started](https://spexcode.net/getting-started/)。

<img src="docs/readme-board.png" alt="看板:spec 树画成可缩放的图,左上角是在跑的 agent 会话,右侧是节点详情">

*SpexCode 自己仓库的看板:spec 树画成可缩放的图,左上角是在跑的 agent 会话,右侧是节点详情。*

## 和 agent 一起工作

这一步需要 tmux 和本机已登录的 [Claude Code](https://www.anthropic.com/claude-code) 或 Codex。

```sh
spex new "让设置页记住上次打开的标签" --node settings
```

会在 `node/settings` 分支的独立 worktree 里启动一个 worker 会话。worker 动代码之前先读管辖 spec,
做出改动,把 spec 正文改写到和实现一致,把两者一起 commit(hook 自动盖 `Session:` 戳),然后提出
merge 并停下。worker 从不自己 merge。

你在外面督工,用看板,或者用 agent 也在用的这几条命令:

```sh
spex watch              # 实时输出会话状态变化:launched / review / done / needs-input ...
spex review settings    # 领先 trunk 的 commit、merge-base diff、typecheck/lint 门
spex merge settings     # 有门禁的 merge 入 trunk
spex session close settings
```

相互独立的任务并行跑。每个 worker 隔离在自己的 worktree 里,merge 由 git 序列化,pre-commit 守卫
拦截对 trunk 的直接提交,所以一切都从可 review 的 node 分支流过。

流程靠机制强制,不靠提示词工程:后端建分支,hook 盖归属戳,materialize 出的契约块承载规则,你的派工
提示词只需要写任务本身。用 agent 驱动 SpexCode 的完整说明见文档站的
[working with agents](https://spexcode.net/working-with-agents/)。

## 测量行为:yatsu

spec 说这部分应该做什么;旁边的 `yatsu.md` 说怎么验。每条 scenario 就是一段普通描述加一个期望结果。
没有 DSL,yatsu 自己什么都不执行:agent 用诚实的任何方式跑这个场景(测试文件、真实浏览器、动手点),
把实际结果和期望对比,连证据一起把读数记档:

```sh
spex yatsu eval settings --scenario remembers-tab --pass --image proof.png
```

读数存在 spec 旁边一个 git 跟踪的 ndjson 里,所以测量和 spec 版本享有同样的归属和历史。修 bug 要求
成对:先记一条复现 bug 的 fail 读数,修掉,再在同一条 scenario 上记一条 pass。

<img src="docs/readme-eval.png" alt="eval 视图:左侧是各 scenario 的读数,中间是选中读数的期望结果、过期原因和录屏证据">

*eval 视图:左侧是各 scenario 的读数;中间是选中读数的期望结果、过期原因和录屏证据。*

## 仓库里有什么

| 包 | 职责 |
|---|---|
| `spec-cli` | `spex` CLI 和 HTTP 后端(Hono,tsx 直跑,无构建步骤)。实时读 `.spec` 和 git;会话状态机和 linter 都在这里。 |
| `spec-dashboard` | React 看板:节点图、每个节点的 spec/history/issues 面板,以及连到每个活跃 agent 会话的真终端。 |
| `spec-yatsu` | 上面说的测量记账。 |
| `spec-forge` | 只读追踪器,把 forge 上的 open issue 和 PR 解析到它们服务的 spec 节点(目前支持 GitHub)。issue 在正文里写一行 `Spec: <node-id>` 即完成链接;从 `node/<id>` 分支开的 PR 自动链接。 |

## linter

`spex lint` 检查 spec↔code 图,它才是真正的门(git hook 只是快速的本地反馈):

- **integrity**(error):`code:` 指向不存在的路径
- **living**(error):spec 正文里出现 changelog 标题
- **altitude**(warn):正文从契约层滑落成实现细节堆
- **coverage**(warn):有被管辖的源文件没有任何 spec 认领
- **drift**(warn):被管辖的代码在 spec 最后一版之后又改了,实时从 git 推导

## 配置

`spexcode.json`(提交进仓库,可移植:布局、lint 预算、看板标识、launcher 名字)和
`spexcode.local.json`(gitignore,单机:launcher 绝对路径,以及给你参与但不拥有的仓库用的
`private: true` 覆盖)承载全部设置。没有 `spex config set`,你或你的 agent 直接编辑文件,每个字段
的文档在 `spex guide config`。其他手册:`spex guide`(工作流)、`spex guide spec`、
`spex guide yatsu`;`spex help` 列出全部命令。

## 现状

SpexCode 用它自己开发自己:这个仓库的 `.spec/` 树就是工具自身的 spec,每个改动都走上面的
worker/manager 循环落地,你装到的看板就是开发它用的那块。它还是个年轻的工具,会有毛边。首次公开
介绍发在 [LINUX DO](https://linux.do) 社区,感谢佬友们的第一轮讨论。

## 参与开发

[`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) 带你从 clone 到第一个合入的改动。
[`docs/AGENT_GUIDE.md`](docs/AGENT_GUIDE.md) 有节点模型和反身配置系统的完整机制。

## License

[MIT](./LICENSE)。
