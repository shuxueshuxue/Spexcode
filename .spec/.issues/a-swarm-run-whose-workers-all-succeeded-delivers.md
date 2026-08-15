---
concern: a swarm run whose workers all succeeded delivers nothing and exits zero: 638 lines stay on their branches
by: d99e859f-0cf6-4e41-8382-2086d209291c
status: open
created: 2026-08-15T05:31:18.564Z
---

Spec: swarm-orchestration

一次真模型、空目录、零脚手架词的端到端跑：三个 worker 全部成功完成并各自提交，
**638 行产出全部滞留在各自分支上，用户的工作区一行源码都没有，而退出码是 0。**

## 读数（同一时钟，UTC）

    05:21:36Z  worker tests-docs 提交   (README 105 · tests 146 · cli 53 · storage 89)
    05:21:38Z  worker cli 提交          (cli.py 56 · storage.py 69 · 其余占位)
    05:22:06Z  worker storage 提交      (storage.py 95 · 其余每个 1 行占位)
    05:22:21Z  根的最后输出，含编号计划："2. 跑完整测试套件 + spex spec lint" "3. 汇报最终结果"
    05:22:22Z  进程退出 · exit 0 · systemd Result=success

    工作区 master：2 个提交、**0 个产品源码文件**
    三条 worker 分支：各 1 个提交，insertions 135 + 401 + 102 = **638 行，0 行交付**

命令：`zcode --cwd <空目录> --mode yolo --prompt "<纯用户话>"`，产物由 8134f5015 现建。

## 这**不是** d66e19335 的复发。那条修复成立，请勿改动它

`d66e19335`（"a swarm parent owns its turn until its workers are done"）已在本次所跑之头内，
且它的提交信息措辞与本现象高度相似——但它的反例读数是
"the lead's transcript stopped writing **in the same second as the root's**"。
本次是 **+15 秒**：根比最后一个 worker 多活了 15 秒。**"等"是成立的。**

⇒ 缺的是**"收"**：`d66e19335` 实现了等待，没有实现收拢。
把本条当成"复发"会让人去改一段本来正确的代码。

## 为什么"收"在这条路径上永远没有机会发生

`apps/zcode-cli/packages/cli/src/prompt-command.ts:34`
`export const runPrompt = async (…): Promise<number>` —— 一次调用、返回退出码、**没有轮次循环**。
模型在 turn 边界打印的"跑测试 / 跑 lint / 汇报结果"在 headless 单轮下无处执行。
⇒ 「收」必须发生在**同一轮内**，否则它不是"晚一点发生"，是"永远不发生"。

## 判据

1. 派发方在**同一轮内**收拢其直接 worker 的产出；
2. 或者：明确报告未收拢**并以非零退出**——不允许在存在未收拢产出时返回 0；
3. 报告必须可执行：至少指出产出在哪（分支名/工作树），使用户或下一轮能自己取回。

**反格（防止用最省事的修法通过）**：
不许用"自动合并 worker 分支"来满足 1——那会把未经审阅的代码直接落进用户工作区；
本条要的是"不许把没交付说成成功"，不是"替用户做合并决定"。

⚠ 另一条已知堵死的逃生口：help 里承诺的 `--max-turns`（"Maximum model turns for headless prompts"）
是 `zcode-help-advertises-six-options-its-own-parser` 里六个被解析器拒绝的选项之一。
所以判据里不得出现"让用户多给几轮"——那条路目前不可用，且多给轮次只是把同一个缺席往后推。

<!-- reply: 644c22c2-e6db-427f-aa24-3a2d883c0336 @ 2026-08-15T06:24:57.415Z -->
# 第二个复现，代价升级：这次滞留的产出被证明是**能用的**

原文的复现是 638 行滞留、0 行交付，但当时**没人知道那 638 行是不是垃圾**——
三个 worker 各写了全部 6 个文件、互不兼容，合起来大概率是一场冲突。

切分修好之后又跑了一次（同一产物、空目录、真模型、零脚手架词）。这次可以回答那个问题：

    5 个 worker，零重叠      7 个源文件，每个恰被 1 个 worker 碰过
    5/5 分支干净合并          零冲突（因为零重叠）
    组装后 python3 cli.py --help   → usage: todo [-h] [--file PATH] {add,list,done}
    add → list → done → list        → [ ] 1. …  →  [x] 1. …
    pytest tests -q                 → **13 passed**

    而用户工作区里：产品源码 **0 行**，CLI 退出码 1，5 条分支被点名

⇒ **这不是一堆废稿没送到，是一个跑得通的工具没送到。**

## 这条读数改变的是缺陷的代价，不是缺陷的形状

形状仍是原来那个：派发方等到了 worker 终态，打印了"稍后收拢"的计划，
而 headless `--prompt` 是单轮，没有下一轮可以执行那个计划。

变的是代价。原文成立时，"没交付"挡住的是一堆无法合并的草稿；
现在它挡住的是一个**已经通过自己全部测试**的产物。
修复的优先级应当按后者估，不按前者。

## 附带：两条阻塞是并列的，不是先后

同一份产物、同一句提示词、同一 env，两次独立跑：

    一次  根建完 spec 树就结束 turn，**一个功能 worker 都没派**（卡在派发）
    一次  派了 5 个、全部完成、全部滞留（卡在收拢）

⇒ 一次跑撞上哪一条取决于模型当轮的走法。**任何一条单独修好，都不能保证用户拿到东西。**
本条只解决第二条；第一条（根在建完树的同一轮里不继续派发）不在本条范围内。

<!-- reply: 644c22c2-e6db-427f-aa24-3a2d883c0336 @ 2026-08-15T06:52:41.634Z -->
# 更正：本 thread 前一条补充里"产品节点 max depth = 1"不构成缺陷证据

前一条我在描述第二个复现时写了「产品节点 6、最大深度 1」，语气上把它列在"仍未达标"那一侧。
**那个口径是错的，现更正——原文不删，留作曾经这样错过的记录。**

## 为什么错

SpexCode 自己的体检里就有一条关于树形状的规则（`spec-cli/src/doctor.ts:149-155`）：

    children >= breadth.maxChildren（默认 8，见 guide.ts:524）才报 'breadth'
      summary: "tree fan-out may be missing a natural grouping layer"
      repair:  "group only along a real seam and **leave genuine peers flat**"

即：**同级节点少于阈值时，平的就是对的**，这是产品写下来的立场，不是谁的偏好。

实测三棵树（用产品自己的判决，不用我们自己数的深度）：

    该复现的树   5 个产品子节点   spex doctor breadth: **healthy**
    另一次跑     3 个产品子节点   breadth: **healthy**
    早前一棵     8 个产品子节点   breadth: **1 finding**

⇒ 一棵 5 个功能节点的树是**平的且健康的**。把它的"深度 1"当成未达标，
**量的是项目大小，不是产品能力**。

## 正确的口径

树形状这条指标应当是：**树在产品说它需要分组的时候，有没有长出分组层**，
判定用 `spex doctor` 的 breadth 格，而不是"有没有第三层"。
这条指标产品已经有了，只是从来没人跑过它。

## 对本 issue 的影响：无

本 issue 讲的是**交付**——worker 产出全部完成却没回到用户工作区。
那条读数（5 分支滞留、组装后 13 测试全过、工作区产品源码 0 行）与树的形状无关，不受此更正影响。
更正的只是我在同一条补充里顺带写下的那句关于深度的判断。
