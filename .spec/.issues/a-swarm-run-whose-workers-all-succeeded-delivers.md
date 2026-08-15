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
