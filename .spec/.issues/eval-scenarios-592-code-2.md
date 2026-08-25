---
concern: eval scenarios: 592 个整文件粒度 code: 应逐场景转为符号锚点
by: 865cee5c-25b1-4e71-a240-1a32b112b14a
status: open
nodes: eval-core, code-anchor
created: 2026-08-25T04:08:33.227Z
---

Spec: eval-core, code-anchor, drift-by-ancestry

## 事实

`spex eval lint` 现状：945 个已声明场景中 664 个 stale（616 条 "code changed"、12 条 "scenario
changed"）。drift 本身是真的，已逐条用 git 核对过——例如 `git-exec/unborn-head-is-empty-history`
锚定的 `packages/spec-core/src/git.ts#sourceIndexes` 确实新增了 `requireGitWorkspace(root)`。
所以这不是判定 bug，是粒度问题。

stale 场景的 828 个 `code:` 条目里，**592 个指向整个文件**，只有 236 个用 `path#symbol` 锚点。
后果是文件里任何一行变动都会 stale 掉挂在它上面的全部场景。集中度：

| stale 条目数 | 文件 |
|---|---|
| 59 | spec-dashboard/src/ReviewShell.jsx |
| 47 | spec-cli/src/sessions.ts |
| 47 | spec-cli/src/harness.ts |
| 36 | spec-dashboard/src/styles.css |
| 36 | spec-dashboard/src/EvalsPage.jsx |

前 5 个文件占全部 stale `code:` 条目的 27%。`spex eval lint` 自己也在报同一件事：
`eval-owners: 48 file(s) are governed by > 3 scenarios`，最差 `sessions.ts(49)`。

## 锚点确实有效，但只是部分

取两次纯改名提交（`7e90b791d` 抽出 workspace core 209 文件、`023e91b4c` 把 `@spexcode/l0` 改名为
`@spexcode/spec-core` 216 文件，414 增 411 删，归一化后只剩一段 spec 正文改写）扫过的文件，
比较两种粒度的 stale 率：

- 全部用 `#` 锚点的场景：32/45 = 71% stale
- 全部用整文件的场景：201/212 = 94% stale

即锚点把 94% 降到 71%，是真实收益但不是消除。剩下的 71% 里有相当部分是符号自身真的变了。

## 为什么不在本轮做

转换不是机械替换：每个场景要知道它究竟测的是哪个符号，判断错了会把 stale 信号变成假新鲜——
比整文件粒度更糟。592 个条目需要逐场景判断，且判断依据是场景的 `description`/`expected` 与它
实际驱动的产品面，不是文件结构。

## 建议做法

1. 按上表从集中度最高的文件入手，一次一个文件，而不是一次一个场景——同一文件的场景往往共享
   同一批符号，一起看才能判断边界。
2. 对每个场景，读 `expected` 决定它断言的是哪个具名单元，再用 `spex spec lint` 的
   anchor 校验确认选择器解析得到东西（`code-anchor` 节点定义了选择器语法与 Tree-sitter 解析）。
3. 转换后该场景会因 `scenario changed` 而 stale 一次，必须重测，不能顺手 ack——这是转换的真实成本，
   应计入排期。
4. `eval-owners` 警告是同一问题的另一面：如果一个文件被 >3 个场景共治且无法拆成不同符号，
   真正的修法是拆文件，不是加锚点。

## 不属于本 issue

- 29 个 codeSha 对象永久丢失（61 条读数不可作证）：裁决为保留，等场景下次被触碰时自然重测。
- 未落地 lane 迁移共享生产库：已指派 51f57a00。
