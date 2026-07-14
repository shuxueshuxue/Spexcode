---
scenarios:
  - name: dry-oracle-gates
    description: >
      从仓库根以 set -o pipefail 运行 npx tsx spec-eval/bench/reconstruction/run.ts dry，单独捕获真实
      exit code，读完整 stdout/stderr。
    expected: >
      exit 0；标头声明 NO agent launch / NO network / NO scoring / NO arm verdicts；六个 clean 构建
      （leaf-spec-lint、leaf-mobile-ui、module-comms、module-lifecycle、whole-all、
      module-comms-code-only）每个的门全部 ✓：no-git、no-symlink、allowlist（默认拒绝成立）、mask
      （leaf/module 见 target gone + parent + sibling，whole 零 .spec 残留）、forbidden-strip、
      leakage 0 violations、future-canary 0 hits、plant-absent、prompt-clean、determinism（双跑
      manifest 字节一致）；code-only 构建额外 budget-strip ✓；leak-positive-twin 行三真
      （mask fired / leakage fired / plant detected）证明检测力；末行 all gates passed ✓，
      dry-report.json 写入 runs/dry/。
    tags: [cli]
  - name: frames-frozen
    description: >
      同 pipefail 纪律分别运行 run.ts select --check 与 run.ts episodes --check，捕获各自 exit code
      与输出。
    expected: >
      两者 exit 0：selection-frozen ✓ 报 c0=038dce1f、cEval=5723eaca、2 leaves、size-matched module
      pair（comms, lifecycle，Δ=1）与 whole；episode-frame-frozen ✓ 报 798 episodes
      （699 pre / 1 migration / 98 post）、482 eligible、primary horizon 430——即提交在案的
      targets.json 与 episodes.json 从各自 pinned 输入字节级重现，任何不重现立刻非零退出。
    tags: [cli]
  - name: pilot-reconstruction-run
    description: >
      【预注册，等人批预算后才测】按 protocol §launch：对 5 个冻结目标（2 leaf、2 module、1 whole）
      各跑一次隔离重建（Claude Code + GLM-5.2 launcher，fresh HOME/CLAUDE_CONFIG_DIR，无网络，
      快照只读挂载），产出 .spec-recon 树与 open-path manifest，全部工件带 manifest 归档为本节点
      eval 证据。
    expected: >
      5 次 R0 全部产出结构合法的 .spec-recon（节点=目录+spec.md，whole ≤3 层）；每次 run 的归档含
      snapshot manifest、PROMPT、agent transcript、open-path manifest；clean 快照 plant 零复述；
      transcript 无网络访问痕迹；失败 run 同样带 manifest 归档并如实记 fail。
    tags: [cli]
  - name: blind-forward-scoring
    description: >
      【预注册，依赖 pilot-reconstruction-run 完成后才测】按 protocol §scoring：fact/decision cards
      在任何 reconstruction 前冻结；6 future tasks（leaf/module 各 1、whole 2 个 module-level）×
      O0/R0/N0 三匿名臂 = 18 主 runs，加 near-miss 与 shuffled-original 两 control × 三尺度 = 24；
      human + 两异族模型 judge 盲评。
    expected: >
      24 runs 全部归档；三臂经中性投影面注入（无 native 格式差）；judge 均不知臂/顺序/original 文本；
      逐 judge 分数 + agreement（Gwet AC2 或 Krippendorff）+ leave-one-judge-out 齐全；三尺度分开
      报告且无任何合成总分；pilot 结论只判协议可行性（泄漏、rubric 灵敏度、方差），不宣称臂胜负。
    tags: [cli]
---

用真实命令行跑 runner 本体（不是 import 内部函数），以 pipefail/显式 rc 捕获判定通过，整份输出作
transcript 证据（`--result`）与 expected 逐条比对后填 reading。前两个场景是本版本可测的 dry-oracle
面；后两个是付费 pilot 的预注册合同——在预算获人工批准并执行之前，它们保持 missing（unmeasured），
这个空缺本身就是诚实的盲区记录，不许用推理或代跑填充。
