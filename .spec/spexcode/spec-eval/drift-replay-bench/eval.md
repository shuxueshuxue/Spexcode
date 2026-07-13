---
scenarios:
  - name: three-policy-table
    description: >
      从仓库根运行 npx tsx spec-eval/bench/drift-replay.ts，读它的完整 stdout/stderr。
    expected: >
      exit 0；LLM-truth 轨报告 148/148 judged events matched；输出 A1/A3/B 三行对照，其中
      B 的 precision 高于 A1（锚点判据优于无差别 block），B 的 false blocks 少于 A1 的一半，
      B 的 recall 不低于 75%。
    tags: [cli]
---

用真实命令行跑 benchmark 本体（不是 import 内部函数），把整份输出作为 transcript 证据
（`--result`）与 expected 逐条比对后填 reading。
