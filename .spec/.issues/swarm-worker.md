---
concern: swarm worker 的隔离是工作目录约定，不是边界：写到工作区外的产出活过了清理
by: d99e859f-0cf6-4e41-8382-2086d209291c
status: open
nodes: swarm-orchestration
created: 2026-08-15T07:36:33.180Z
---

Spec: swarm-orchestration

## 读数（机械可复核）

一次 3-worker 的 swarm 跑结束、三条分支已合入、三个被 provision 的工作区均已清理之后，
盘上留下一个**不是工作区的目录**：

    /home/jeffry/zcode-subagent-sess_subagent-agent_dea2f469-c277-42ff-a953-e20c3debed0d
                                  ^^^^^^^^^^^^^^ 连字符，真工作区是 sess_subagent_agent_（下划线）

    session 表匹配行数        0
    是否 git 仓库             否（fatal: not a git repository）
    内容                      仅 storage.py，116 行 / 4114 bytes
                              与最终合入 HEAD 的那份行数相同、字节不同

读法（标明为读法）：storage-impl worker 把产出多写了一份到一个打错的路径上。

## 两个结论

**(a) 隔离是约定，不是边界。** worker 的"只碰自己那份"靠的是工作目录，不是强制；
    它能写到工作区外面，而且这次写了。

**(b) 打错的那份活过了清理。** 清理删的是被 provision 的工作区，而它从来不是，所以没人管它。

## 这同时使一条既有读数降级

"5 个 worker、零文件重叠"是用 `git diff --name-only <base>..<branch>` 量的，
而 **git diff 按构造看不见仓外的任何东西**。所以准确说法只能是：

    在仓内，零重叠。          ← 成立
    worker 没写别的地方。      ← 从未量过，且现在有一个反例

## 建议的验收判据（要能机械检查，不要写成"worker 不应写到工作区外"）

正面：一次 swarm 跑结束后，除被 provision 的工作区外，
      不应存在任何以该 worker session id 命名的路径（**含拼写变体**）。

反面（不许这样通过）：靠"清理时把凡是像 worker 目录的都删掉"——
      那会误删他人产物，而且掩盖了写入本身。

## 实现这条判据时的一个坑（已踩，记在这里）

第一版检查报"19 个 worker、仓外留痕 0 个"，实为 18 个——
worker 清单文件末尾缺一个换行符，`while read` 静默丢掉最后一条，
**而那一条恰好是唯一的阳性**。补上换行后：19/19，留痕 1 个。
⇒ 该判据的实现必须自证"检查条数 == worker 条数"，否则它会以最像通过的方式失败。
