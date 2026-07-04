# 宣传反推压力测试:六个长用户故事

> 方法:把宣传稿里的每句承诺放到一个具体用户的完整旅程里走到底,看它在哪一步裂开。
> 每个故事都踩在真实代码、真实 issue、或本会话亲历的事故上——不虚构。
> 用途:①筛掉稿子里撑不住的句子;②反推出产品该修的缝。

---

## 故事一:《clone 下来,证据全是 404》

老周信了稿子里那句"git 是数据库,你 clone 下来,数据就全在了",还有"截图/视频作为证据内容寻址存进 git"。他把团队仓库跑了两个月的 spec 树连读数一起 clone 到新同事的机器上,打开 dashboard 的 Evals 页——每条读数都在,版本、判定、note 一字不少,但点开任何一条:图挂了,视频 404。

新同事的第一反应是"部署坏了",查了一下午 nginx。真相在 `spec-yatsu/src/cache.ts:11`:证据 blob 存在 `<git-common-dir>/spexcode/yatsu-blobs/`——**在 `.git` 目录里面、但在 git 对象库外面**。`git clone` 不搬它。而且这是**故意的**(cache.ts:64 原文:"pixels never leak into git history",pre-commit 还有 backstop 拦截像素进 git)。设计有它的道理——40MB 的 webm 不该进历史——但宣传句"证据存进 git"就是**假的**:读数进了 git,证据在 git 旁边,clone 即失联。

> 本会话亲历版:给隔离 clone 起 demo 后端,eval 页视频台一片空白,查了三层(选择器?挂载时机?)才发现是 blob 404,手动 `cp -r .git/spexcode/yatsu-blobs` 才救活。我们自己人都要踩,用户必踩。
> 论坛早有存档:`adoption-via-spex-init-ships-no-measurement-evid.md`。

**反推动作**:①稿子那句话已改(见 diff);②产品缺一个 `spex blobs sync/pack` 之类的搬运 verb,或至少在 dashboard 上把 blob-miss 渲染成"证据在源机器上,跑 `spex …` 取回"而不是裸 404。

---

## 故事二:《两台机器的小团队》

阿珍和阿强各自一台机器,共用一个 GitHub 仓库,都装了 SpexCode。稿子说"派发 worker、看板监工",他们照做——各自机器各跑一个后端,各自派 worker,各自 file 读数。

第一周就撞上三件事:

1. **对方的读数永远 stale**。阿珍在自己的 node 分支上 file 的读数,codeSha 是她分支上的 commit;阿强 pull 下来,freshness 在 main 历史里定位不到这个 sha,保守判 stale。规则其实是"**任何未合分支上 file 的读数,合入前全网读 stale**"——单机自 dogfood 时无感(自己很快 merge),双机协作时变成常态噪声。(本会话亲历:我的两条视频读数就这样"永久 stale",直到 3ed32096 cherry-pick + main-HEAD 重测才救回;freshness 对"孤儿 sha vs 可达 sha"不分家的问题已并入 drift-signal Layer-2 评估。)
2. **ndjson 合并冲突**。两人同周对同一节点 file 读数,`yatsu.evals.ndjson` 在 merge 时冲突——格式是追加型的,git 却按行冲突处理。(亲历:我 merge main 时手写 python 做 union+按时间排序。)这活不该用户手工做。
3. **issues 库的锁是本地目录锁**。`proposals.ts` 用 `<mainCheckout>/.git/spexcode-forum.lock`(mkdir 原子锁)串行化写——**同一台机器**上是对的,两台机器根本锁不到彼此,靠 git 冲突兜底,而 remark 文件的 HTML 注释格式冲突起来不好看。

**反推动作**:文案层面,"团队协作"的口今天不能开——诚实定位是"单机单 trunk,多 agent";产品层面,读数的 freshness 需要 refs 可达性判断(和 2ea5b44 的 driftIndex 线性近似是同一根病),ndjson 需要 merge driver(union 策略一行 `.gitattributes` 就能声明)。

---

## 故事三:《只用 Codex 的车间》

一个店只买了 Codex 的账号。稿子说"Claude Code 和 Codex 自动发现,零接线",他们 `spex init`,`AGENTS.md` 里契约块确实长出来了,Codex 也确实读到了——第一天很美。

第二天裂缝:派发出去的 Codex worker **不触发生命周期 hook**(论坛在案:`codex-lifecycle-hooks-don-t-fire-for-a-dispatche.md`)——意味着 Stop 门不拦它,worker 可以不 commit 不申报就溜走,整个"commit-before-declare"契约对 Codex 是**纸面契约**。再查,`materialize` 可能已经不产 `.codex` shim 了(`materialize-may-have-stopped-emitting-the-codex-.md`)。而默认 worker 启动命令的环境变量叫 `SPEXCODE_CLAUDE_CMD`——名字都替你选好了阵营(有 `SPEXCODE_CODEX_CMD`,但文档、部署脚本、排障笔记全部只演过 Claude 路径)。

这和视频录制那个故事是**同一个病的两个症状**:中立性(harness-agnostic)在 spec 里声明过、在架构上留了缝(适配器层、shim 按 harness 各自拥有),但**只在一个栈上被验证过**。声明的中立性 ≠ 被测的中立性。

**反推动作**:文案上"Codex 自动发现"可以讲(材料化确实覆盖),但"零接线跑完整工作流"不能讲,除非先关掉那两个 issue;产品上缺一个 harness 兼容性冒烟单——`spex self doctor` 就是现成的挂点。

---

## 故事四:《不碰 AI 的保守团队》

一家对 AI 有合规顾虑的公司,只信稿子里那句"剥掉 AI,核心还是纯工具:spec 文件 + lint + 只读 dashboard,只要 Node 和 git"。

这句**基本成立**——lint 和 dashboard 真的只吃 Node+git,这是稿子里最经得起压的一句。但走完整个月会发现三个"没骗你,但也没告诉你"的地方:

1. `spex init` 种下的大半东西对他们是**死重**:CLAUDE.md/AGENTS.md 契约块、`.claude` shim、stop-gate、`/` 预设——全是 agent 机器件,在无 agent 车间里是没人读的祭文(无害,但让"纯工具"的第一印象打折)。
2. **drift 警告没有下游**。lint 会告诉你"代码跑到 spec 前面了",但修复动作(重写 spec / ack / 修代码)在这家店全靠人肉,而 ack 的语义("我检查过,spec 仍然有效")设计上是给 review 循环重新评判用的——没有 agent 循环时,ack 退化成一个没人复核的自我声明。
3. **yatsu 整层空转**。没有 agent 跑场景,损失信号无人产读数——而稿子里最锋利的卖点(A/B、视频标注)全部长在这层上。

**反推动作**:这个故事不暴露 bug,暴露**文案的分层责任**——"无 AI 也成立"的承诺应该精确绑定到 lint+看板,别让读者以为三层卖点都无 AI 可得。稿子当前的写法(vibe-coding 层"架在上面")方向对,可以再加一句"损失信号层需要有人/agent 跑测量"。

---

## 故事五:《四百节点的十年老仓库》

一家公司拿着十年历史、40 万 commit 的 monorepo 来了。稿子说"版本 = commit 数,drift 实时从 git log 推导,没有外部数据库"——他们听懂的是"免费",没听懂的是"每次读都要问 git"。

真实数据可以给他们校准预期:adopter-a(417 节点)和本仓库(146 节点)都活得不错,但每个"不错"背后都有一次修理:board 冷启动曾经 2.4 秒打满(修成 boardCache 后 20-75ms);`spex search` 每次全量算 92k token 相似度、1.3 秒;drift 判定是**线性 log-position 近似而不是 git 祖先关系**(审计在案:2ea5b44)——历史越分叉,误报越多,故事二的"分支读数永久 stale"就是同一个近似在另一处的账单。version 计数走 `git log --follow`,在深历史大仓库上是每节点一次不便宜的遍历。

**反推动作**:文案上"git 是数据库"应该带上它的性能故事——"我们在 400 节点上跑,冷启动踩过坑、修了缓存",这比裸承诺可信;产品上,driftIndex 从"线性位置"升级到"refs 可达性"是把故事二、故事五两笔账一起还的那笔钱(已在 Layer-2 评估里)。

---

## 故事六:《重构之晨》

一个团队信了"spec 是活文档",养了三个月的树,然后干了所有正经团队都会干的事:一次大目录重构。第二天早晨,`spex lint` 打出几十条——`code:` 路径断了的 integrity 错误、搬了家的文件对着旧 spec 的 drift 警告、连带几个 body 超预算的 altitude 提醒。

这不是假设:**本 dogfood 仓库此刻就挂着 28 条 drift + 43 条 altitude 警告**,而 git log 里躺着大重构后的还债记录——`18c5db0`"给四条 refactor-scope 的 1-commit drift 警告盖 Spec-OK 章"。工具的应对机制都在(reparent 按纯 rename 不计版本、ack 留痕、驱动到 review 复核),但**宣传里只讲了"drift 是实时算出来的"这半句**,没讲"重构次日你要人工分诊每一条警告:重写 spec / ack / 修代码 / 改 code: 链接,四选一,一条条来"。

**反推动作**:这是"活文档"承诺的真实成本曲线,文案与其藏,不如把 ack 工作流做成卖点讲出来("警告不是罚单,是分诊单");产品侧,batch-ack(按重构 commit 范围一次盖章)是重构之晨最想要的那只手——现在 `spex ack <node>…` 已收多个节点,离"按 commit 范围"只差半步。

---

## 汇总:六个故事各自咬住的宣传句

| 故事 | 咬住的句子 | 判定 |
|---|---|---|
| 一 | "证据内容寻址存进 git / clone 即全量" | **假,已改稿**;产品缺 blob 搬运 verb |
| 二 | (隐含的)"团队用" | 今天不能承诺;freshness/merge-driver 两个真缺口 |
| 三 | "Claude Code 和 Codex 零接线" | 半真;Codex 工作流两个在案 issue 未关 |
| 四 | "剥掉 AI 也成立" | 真,但要把承诺精确绑到 lint+看板层 |
| 五 | "git 是数据库" | 真,但该带性能履历讲 |
| 六 | "spec 是活文档" | 真,但要把 ack 分诊成本讲成工作流 |
