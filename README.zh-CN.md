<img src="docs/sdd-tuxedo-pooh.png" alt="写代码 vs. 维护一份活的、可执行的规格文档" width="420">

[English](./README.md) | 中文

> Spec 驱动开发通常死于两种方式:spec 和代码脱节,或者膨胀成一堆过时的仪式文档。SpexCode 让每个
> spec 保持简短、保持当前态:原地重写,由 git 记版本,不做累积式的 changelog。

**SpexCode** 是一个 spec 驱动、用自己开发自己的开发工具。项目的每个部分都是一个带版本的
*spec 节点*,即一个 `.spec/**/spec.md`,正文描述这个部分当前的意图。git 就是数据库:节点的版本号
是它的内容 commit 数,"drift" 指被管辖的代码走到了 spec 前面。`spex` CLI 和实时看板直接从 git
读取这一切,没有第二份存储。

- **[使用 SpexCode](#使用-spexcode)**:安装 `spex` CLI,通过你的 coding agent 治理*你自己的*项目。
- **[参与开发](#参与开发)**:在本仓库里改进工具本身。
- **[Working with agents →](https://spexcode.net/working-with-agents/)**:文档站上更完整的介绍。

---

## 使用 SpexCode

SpexCode 只需要设置一次(`npm i -g spexcode`,然后在你的仓库里 `spex init`)。之后的主要用法是和
你的 coding agent 对话:用自然语言说你要什么(*"给鉴权流程加一个 spec 节点""把这个包的 spec
提取出来""派一个 worker 去实现 Y"*),agent 替你执行 `spex` CLI,你在看板上盯进度。下面的手动
CLI 是底座,agent 才是日常界面。

这套之所以成立,是因为新启动的 agent 已经认识 SpexCode。`spex init` 会把整套约定(spec 节点流程、
先 commit 再声明完成、merge 方式)生成到仓库 `CLAUDE.md`/`AGENTS.md` 里的 `<!-- spexcode -->`
托管块中,**[Claude Code](https://www.anthropic.com/claude-code)** 和 **Codex** 启动时自动读到。
更细的内容 agent 自己按需查内置手册:`spex guide`(工作流)、`spex guide spec` /
`spex guide yatsu`(文件格式)、`spex guide config`(`spexcode.json` 的全部配置项)。你可以直接
对它说*"跑一下 `spex guide config`,帮我配好 launcher"*。

完整的说明在文档站:**[working with agents](https://spexcode.net/working-with-agents/)** 讲
agent 驱动的用法,**[getting started](https://spexcode.net/getting-started/)** 从头到尾走一遍安装。

> **抛开 agent,它也是一套普通工具。** 核心部分单独用也成立:git 记版本的 spec 文件,`spex lint`
> 检查,只读看板展示。不含 AI,除了 Node 和 git 什么都不用跑。vibe coding 的玩法建立在这层之上,
> 不是替代它。

> **环境要求。** 核心:**Node ≥ 22** 和 **git**。要通过 agent 驱动(或者往节点上派 worker),
> 还需要 **tmux** 和 PATH 里已登录的 **Claude Code 或 Codex**。这些 agent 会在你的机器上执行
> 命令,对外暴露后端之前请先读 [`SECURITY.md`](./docs/SECURITY.md)。

### 安装

装一次发布版 CLI,然后在任何项目里接入:

```sh
npm i -g spexcode      # 安装 spex 命令(需要 Node ≥ 22)
cd ~/my-app
spex init              # 纯增量,不会动你的代码结构
```

`spex init` 是增量式的:生成一棵起始 **`.spec/`** 树(根 `project` 节点,加上定义开发流程的
`.config` 插件)、一份起始 **`spexcode.json`**、每个 clone 各自的 **git hooks**(`pre-commit`
跑 **spec-lint**,spec↔code 链接坏了会拦下;**main-guard** 拦截直接向 `main` 的提交;
`prepare-commit-msg` 给每个 commit 盖 session 归属戳)。同时生成 agent 路径需要的产物:
`CLAUDE.md`/`AGENTS.md` 里的 `<!-- spexcode -->` 契约块,以及 `.claude/`、`.codex/` 的
settings hooks。这些产物是生成物,已被 gitignore,每台机器各自重新生成,不进版本库。

然后把它变成你的项目,让 agent 改或者自己动手都行:编辑 `.spec/project/spec.md` 描述项目,把
`spexcode.json` 的 `lint.governedRoots` 指向真实源码目录,再检查一遍:

```sh
spex lint              # coverage 警告就是你的接入 TODO 清单
```

### 配置

仓库根目录两个可选的 JSON 文件承载全部设置,按可移植性分开:

- **`spexcode.json`**:提交进仓库,可移植。布局、看板标识(`title` + `icon`)、lint 预算、
  launcher 的**名字**。对整个项目成立的事实。
- **`spexcode.local.json`**:gitignore,单机。launcher 命令的绝对路径、证书和密钥路径、私有覆盖
  开关(`private: true`,让 `spex materialize` 在被跟踪的文件里不留任何痕迹,ignore 写进本地
  git exclude 而不是提交的 `.gitignore`,适合你参与但不拥有的仓库)。只对这台机器成立的事实。

没有 `spex config set`,你(或你的 agent)直接编辑文件。每个字段的含义、该放哪个文件,
**`spex guide config`** 是权威手册。

### 运行

启动后端和看板,打开页面:

```sh
spex serve          # 后端(API + sessions),:8787
spex dashboard      # 看板 UI,:5173,/api 代理到后端
```

打开 <http://localhost:5173>。

两个端口都是参数(`spex serve --port 8788`、`spex dashboard --port 5174 --api-port 8788`),
多个项目的看板可以并排跑,工作目录决定各自服务哪个项目。每个标签页的身份在各自项目的
`spexcode.json` 里配:`dashboard.title` 定名字,`dashboard.icon` 定 favicon,emoji(`"🔭"`)、
Iconify 名字(`"mdi:rocket-launch"`)或 URL 都行。

日常命令(agent 替你跑,你也可以自己跑):

| 命令 | 作用 |
| --- | --- |
| `spex lint` | 检查 spec↔code 图:coverage、drift、living 规则 |
| `spex watch` | 实时输出 session / 看板的状态变化 |
| `spex guide` | 打印完整工作流,以及 `spec.md` / `yatsu.md` / `config` 手册 |
| `spex board` | 以 JSON 输出当前看板状态 |

---

## 参与开发

这个仓库就是 SpexCode 的源码,而且它 dogfood 自己:工具的每个改动都以 spec 节点的形式合入
`main`。搭一个开发环境:

```sh
git clone https://github.com/shuxueshuxue/spexcode && cd spexcode
npm --prefix spec-cli install
npm --prefix spec-dashboard install
npm run hooks          # 安装每个 clone 各自的 git hooks(main-guard + session 戳)
```

开发循环直接跑源码,带热重载(开发用 `npm run web`,区别于安装用户的 `spex dashboard`):

```sh
npm run api            # 后端 :8787,spec-cli/src 改动即热重载
npm run web            # Vite 起看板(HMR),/api 代理到 :8787
```

---

## 致谢

SpexCode 的首次公开介绍发在 [LINUX DO](https://linux.do),感谢佬友们的第一轮讨论和反馈。

## License

[MIT](./LICENSE)。
