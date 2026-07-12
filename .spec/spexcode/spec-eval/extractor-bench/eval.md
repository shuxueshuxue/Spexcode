---
scenarios:
  - name: bench-rerun
    description: >
      在干净树上跑一条命令 `npx tsx spec-eval/bench/run.ts`(工作树无 node_modules 时先按机器惯例链接主
      checkout 的)。看三件事:花名册(anchors.ts 已合入时应为其注册表行 + heuristic 参考行,未合入时为
      seed-r5b 且明示 wiring point idle)、对照表(每个提取器 × 语言类别 × all/value-only 切片的
      名称P/R + 区间精度,阴性对照无假阳性泄漏警告)、基线门(与 baseline.json 对比)。
    expected: >
      一次运行打出全花名册对照表;聚合分不低于 baseline.json 的在案基线,收 "baseline: no regression ✓"
      且 exit 0;人为抬高基线复跑则必须打出 REGRESSION 行并 exit 1(门是真的)。
    tags: [cli]
    code: spec-eval/bench/run.ts
    related: [spec-eval/bench/truth.json, spec-eval/bench/baseline.json]
---
测量方法:直接跑真实命令读 stdout 和退出码,不读源码推断。分数的可比性锚在冻结语料上——语料快照或
truth.json 变了,本场景的历史读数即作废,需重新出分。
