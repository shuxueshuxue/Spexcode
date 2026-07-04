# 【linux.do 宣传稿草稿】

> 目标板块:软件开发 / 搞七捻三(视最终定位)
> 风格:论坛第一人称分享帖,不带营销腔,全部数字可在仓库里验证

---

## 标题候选(按推荐排序)

1. 17 天前我给 Claude 发了一段中文 prompt,今天它长成了一个自己治理自己的开源 dev 工具
2. 用 AI 写代码的"第二天问题":第一天是它教你,第二天起是你在教它——我们造了个工具来解决这个
3. spec 驱动开发的两种死法,以及我们怎么用 git 当数据库把它救活的

---

## 正文

17 天前(6 月 17 日),我给 Claude Code 发了这么一段 prompt:

> 一个 node-graph 形态的界面,每个节点是一个 spec,spec 呈现树状关系。spec 有版本变迁历史,每次版本变迁都 attribute 到一个 claude code session。用户的所有指令落实到一个具体的 spec 节点上,也可以由一个层级较高的 spec 节点来进行子节点自动分配和创建,节点上只能有一个正在工作的 claude code session,每个 claude code session 都在自己的 worktree 里面,都是基于最新的 main 分支创建的。

今天,这段 prompt 逐字保存在这个项目自己的 spec 树的根节点里,而围绕它长出来的东西是:**1642 个 commit、594 次 merge、143 个 spec 节点、750 条带截图/视频证据的测量记录**——一个已经发到 npm 的开源工具,叫 **SpexCode**。最魔幻的是:从第一周起,它的每一次改动就都是用它自己管理的。

【图 1:`promo-assets/01-board-full.png` — dashboard 板视图全景(spec 树 + 左侧实时会话栏)】
【视频:`promo-assets/05-board-tour.webm` — 20 秒巡览:板 → 下钻 spec-cli → 节点场景 → 损失信号页】

### 先说痛点:AI 写代码的"第二天问题"

用 Claude Code / Codex 这类 agent 写代码,第一天体验都很好。问题从第二天开始:

- agent 改了代码,但**没人记得这个文件现在到底该干什么**——文档(如果有的话)停留在上周;
- 你想让 agent 接着改,它读的是代码的"现状",不是你的"意图",于是每次都要重新解释一遍;
- 上了 spec-driven development(SDD)的团队会发现 spec 有两种死法:要么**漂移**(代码改了 spec 没改),要么**腐烂成仪式**(spec 变成没人读的 changelog 坟场)。

我们把 Hacker News 和各家 SDD 项目 issue 区里的抱怨收集了一遍(整理成了一篇 blog,链接在最后),结论是这两种死法几乎是所有 spec 工具的宿命。

### SpexCode 的三个反常识设计

**1. git 就是数据库,没有别的存储。**

每个被治理的模块是一个 `.spec/**/spec.md` 节点。节点的"版本号"= 这个文件的内容 commit 数;"谁改的"= commit 上的 session 归属 trailer;"漂移"= 被治理的代码在 spec 最后一次提交之后又动了——**全部实时从 git log 推导,没有任何外部数据库**。dashboard 只是 git 之上的一个读时聚合器。你 clone 下来,数据就全在了。

**2. spec 是活文档,lint 强制执行。**

spec 正文永远描述模块的**当下意图**,原地重写,禁止堆 `## v1 / v2 / v3` 式的 changelog(版本历史是 git 的活,不该由人肉维护)。`spex lint` 把这条当规则查,连同:spec 指向的代码文件还在不在、被治理的源文件有没有 spec 认领(coverage)、代码是不是跑到 spec 前面去了(drift)。spec 腐烂不再靠自觉防,靠 CI 防。

【图 2:`promo-assets/04-spex-lint.png` — spex lint 真实输出(drift 警告 + "Never patch" 修复指引)】

**3. 损失信号(yatsu):每个节点可测量,修 bug 必须 fail→pass。**

每个节点可以挂场景(描述 + 预期),用真实浏览器/真实 API 跑出读数,截图/视频作为证据内容寻址存进 git。修 bug 的纪律是 A/B:先跑出一条**失败读数**复现它,修完再跑出**通过读数**——一个 bug 的完整生命周期在时间线上可回放。这个仓库目前有 750 条这样的读数。

【图 3:`promo-assets/06-evals-feed.png` — 损失信号页:左列读数流(pass/fail+证据类型),右侧展开一条真实浏览器测量(expected vs note + 截图证据 + 评审轨)】

### 视频标注工作台:人类 review 的主战场

损失信号里最狠的一层是**视频证据 + 标注工作台**。e2e 测量可以录整段屏(带 step-timeline 边车),按场景自动切成剪辑归档;人在 dashboard 的三栏工作台里 review:

- **自定义 review 滑轨**:每条 anchored remark 是滑轨上的一个 marker,播放头会点亮正经过的 remark;点 marker 或点评论即 seek 过去;
- **拖拽圈选**:在暂停帧上框住一处问题,那一帧(带框)自动进 blob 存储,右侧常驻 composer 被预填一条 anchored remark(`▶m:ss` 锚点 + 帧图)——**圈完就写,不用上下滚**;
- **A/B 历史条**:一个场景的 fail→pass 全生命周期(✗=复现 / ✓=修复)在顶栏原地翻页;
- **remark 有牙齿**:一条未 resolve 的人类 remark 会让场景变 stale,必须由第二方 agent `spex resolve` + 新读数才算清——人类不是点 pass/fail 的橡皮图章(那个按钮我们删了),人类通过 remark 审判。

【视频:`promo-assets/08-annotator-golden-path.mp4`(23s)/ 同名 `.gif`(3.7MB,960px,论坛直贴)— 连续操作实录:打开视频 eval → marker seek → 圈选一帧(框实时画出)→ composer 自动预填锚点+帧图 → 补一句"这里该修 @new"发出 → **真的派发了一个 agent**(左上角闪现 `@ new→<session>` 回显)→ 滑轨新 marker 点击 seek → 翻 A/B 历史】
【图 4:`promo-assets/09-annotator-compose.png` — 圈选后:composer 预填 ▶0:02 锚点 + 帧图预览,视频还在屏上】
【图 5:`promo-assets/10-annotator-remark-landed.png` — remark 上墙:评审轨第 3 条,锚点 chip + 圈选帧图内嵌,滑轨新 marker】

这一段演示本身就是 dogfood:录制它的会话把这两个场景当真实测量跑了一遍,`spex yatsu eval --video --timeline` 归档了两条带剪辑+时间线的新读数——录demo的过程同时给仓库补上了它当时缺失的新鲜视频读数(之前为 0)。更妙的是:就在录制进行的同一时段,另一个会话的真浏览器重测抓到了一个真 regression(页面拆分让 #/evals 的 @-派发回显静默失声),按 fail→pass 的 A/B 纪律修复合并——**这个工具在用自己录自己的宣传素材时,还顺手修了自己的 bug**。

### 它不只治理自己

除了自我狗粮,我们拿它治理了两个真实项目:一个跨平台 AI coding agent(**417 个 spec 节点、300+ 条测量读数,测出了真 bug**),和一个 Electron 桌面应用(~99 节点)。提取 spec、并行派发 worker、真浏览器 e2e 测量,整条链路都是在别人的代码库上跑通的。

### agent 原生,但剥掉 AI 也成立

`spex init` 会把整套开发契约(spec 节点怎么写、先 commit 再声明完成、merge 风格)物化进你仓库的 `CLAUDE.md`/`AGENTS.md` 托管块——Claude Code 和 Codex **自动发现**,零接线。之后你日常就是对 agent 说人话:"给鉴权流程加个 spec 节点"、"派个 worker 实现 Y",它自己会跑 `spex` CLI,你在 dashboard 上监工。

但把 AI 全剥掉,核心还是纯工具:git 版本化的 spec 文件 + `spex lint` + 一个只读 dashboard,只依赖 Node ≥ 22 和 git。vibe-coding 那层是架在上面的,不是必需的。

### 上手

```sh
npm i -g spexcode   # spexcode@0.1.6
cd ~/my-app
spex init           # 纯增量,不动你的代码结构
spex lint           # coverage 警告就是你的采纳 TODO 清单
```

- 仓库(MIT):https://github.com/shuxueshuxue/spexcode
- 文档站:https://spexcode.net/
- 两篇 blog:《The Second Day Problem》《The Pain-Point List》(痛点调研原始材料)

17 天,从一段中文 prompt 到一个自己治理自己的工具。欢迎拍砖,尤其欢迎拿你自己的项目试 `spex init` 然后来骂哪里不好用——issue 区见。
