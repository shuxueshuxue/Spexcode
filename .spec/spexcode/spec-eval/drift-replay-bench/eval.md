---
scenarios:
  - name: three-policy-table
    description: >
      从仓库根运行 npx tsx spec-eval/bench/drift-replay.ts，读它的完整 stdout/stderr。
    expected: >
      exit 0；输出以 Y1 localizer track 标头声明口径（并声明非 Y2、非因果）；LLM-truth 轨报告
      227/227 judged events matched；A1/A3/B/B′ 四行对照加 anchored-only 子表，其中 B 的
      precision 为四者最高且高于 A1，B 的 false blocks 少于 A1 的一半，B′ 的 recall 不低于
      85%，anchored-only 子表的 B recall 不低于 75%。
    tags: [cli]
  - name: channels-episodes-gates
    description: >
      同一次 npx tsx spec-eval/bench/drift-replay.ts 运行的后半段输出：动作通道表、episode 段、
      人工盲审队列校验行、acceptance gates 块。
    expected: >
      动作通道表给出四策略的 block%/blockP/warn%/warnP/warn-capture，A1 的 warn 通道为空
      （n/a），silent 列全 0 并注明结构性为空；episode 段报告 sound episodes / no-episode /
      unresolvable 三类窗口计数，逐条列出 sound episode（节点、onset、resolution 种类、dwell
      commits+days、R1 foreign-sessions 与 unattributed），并将 unresolvable 窗口逐条点名
      （unlabeled prefix），R1 明示为 git-only 下界；队列行报告 40 blinded rows、deterministic、
      no label leakage、human-filled 计数（未填时标 PENDING — not yet human validation）；
      acceptance gates 全部 ✓（judged 全匹配、通道互斥完备、队列确定性+盲、窗口分类完备、
      基线一致），末行 all gates passed ✓。
    tags: [cli]
---

用真实命令行跑 benchmark 本体（不是 import 内部函数），把整份输出作为 transcript 证据
（`--result`）与 expected 逐条比对后填 reading。两个场景对应同一次运行输出的前半（Y1 主表）
与后半（通道/episode/队列/验收门）。
