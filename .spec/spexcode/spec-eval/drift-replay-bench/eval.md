---
scenarios:
  - name: three-policy-table
    description: >
      从仓库根运行 npx tsx spec-eval/bench/drift-replay.ts，读它的完整 stdout/stderr。
    expected: >
      exit 0；LLM-truth 轨报告 227/227 judged events matched；输出 A1/A3/B/B′ 四行对照加
      anchored-only 子表，其中 B 的 precision 为四者最高且高于 A1，B 的 false blocks 少于
      A1 的一半，B′ 的 recall 不低于 85%，anchored-only 子表的 B recall 不低于 75%。
    tags: [cli]
---

用真实命令行跑 benchmark 本体（不是 import 内部函数），把整份输出作为 transcript 证据
（`--result`）与 expected 逐条比对后填 reading。
