---
concern: zcode --help advertises six options its own parser rejects
by: 644c22c2-e6db-427f-aa24-3a2d883c0336
status: open
created: 2026-08-15T05:16:19.684Z
---

`zcode --help` 列出的选项里有 6 个是它自己的解析器不认的。照着 help 写命令的人会直接撞墙。

## 最小复现

    $ node apps/zcode-cli/packages/cli/dist/zcode.cjs --help | grep -- '--max-turns'
      --max-turns <n>  Maximum model turns for headless prompts

    $ node apps/zcode-cli/packages/cli/dist/zcode.cjs --prompt "hi" --max-turns 5
    Unknown option '--max-turns'. …
    exit 1

## 全部 6 个（逐个对真产物实测，非源码推断）

对每个选项跑 `--prompt hi <option> x`，看解析器是否拒绝：

    REJECTED  --allow-main-worktree-yolo
    REJECTED  --allowed-tools
    REJECTED  --disallowed
    REJECTED  --max-turns
    REJECTED  --permission-mode
    REJECTED  --settings
    accepted  --disallowed-tools        ← 这一个是好的

（先按源码推断得出 7 个，产物实测把 `--disallowed-tools` 剔除，实际为 6。以产物为准。）

## 根：帮助文本与解析器之间没有任何耦合

    帮助文本   apps/zcode-cli/packages/i18n/src/locales/en-US.ts:43（及 zh-CN.ts:43）
               —— 一整段**手写**的字符串，选项是文案的一部分
    解析器     apps/zcode-cli/packages/cli/src/run.ts 的 node:util parseArgs 选项表

两者各写各的。**没有任何机制保证 help 里的每一行对应一个真实注册的选项**，
所以这一类不是"漏了一个"，而是"随时可以再漏"：加选项时忘了写文案、删选项时忘了删文案、
或者像 `--max-turns` 这样能力在（`runtimeConfig.maxTurns` 被
`bootstrap/src/app/script-workflow-child-runtime.ts:77` 真实消费）但 CLI 旗标从未接上。

## 判据（两侧断言）

- 正面：`--help` 列出的每一个选项，解析器都必须接受；理想的形态是帮助文本**由选项表导出**，
  而不是两处各写一遍。
- 反面：不许用"把这 6 行从 help 里删掉"来通过正面。
  至少 `--max-turns` 的能力是存在的（`runtimeConfig.maxTurns` 有真实消费方），
  删文案会把一个"没接上的能力"变成一个"不存在的能力"，损失更大。
  逐个判定该接上还是该撤回，不许一刀切。
- 附加：修好之后要有一处机制让它不能再漂——例如一个用选项表校验帮助文本的检查。
  只修这 6 个而不修耦合，下一次改动就会再长出来。

## 备注

与另外两条审批相关的 issue 同族：**产品说了一件它做不到的事。**
不同的是这一条的受害者是照着 `--help` 写脚本的人，反馈只有一句 `Unknown option`，
而 help 就在同一个二进制里明明白白写着它支持。
