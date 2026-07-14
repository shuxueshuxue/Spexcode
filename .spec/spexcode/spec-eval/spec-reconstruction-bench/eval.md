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
      同 pipefail 纪律分别运行 run.ts select --check、run.ts episodes --check 与 run.ts tasks --check，
      捕获各自 exit code 与输出。
    expected: >
      三者 exit 0：selection-frozen ✓ 报 c0=038dce1f、cEval=5723eaca、2 leaves、size-matched module
      pair（comms, lifecycle，Δ=1）与 whole；episode-frame-frozen ✓ 报 798 episodes
      （699 pre / 1 migration / 98 post）、482 eligible、primary horizon 430；task-frame-frozen ✓ 报
      2 leaf future tasks（spec-lint→3f07397f preState fa18935a、mobile-ui→f308cded preState 171b7cf0），
      即每 leaf 取 first-parent 序最早可回放 eligible episode（机械 replay 排除依赖同 episode 新建兄弟
      模块的候选）——三个冻结文件从各自 pinned 输入字节级重现，任何不重现立刻非零退出。
    tags: [cli]
  - name: pilot-preflight-gates
    description: >
      【付费 pilot 前置，无模型调用】从仓库根运行 run.ts pilot preflight，捕获 exit code 与
      runs/pilot/preflight.json。
    expected: >
      exit 0，9 门全绿：frames-frozen、dry-oracle、credential-file（mode=600，只记 keyLen+sha256 前缀，
      不记值）、endpoint-reachable（TLS verify=0，无消息体）、egress-bridge-reaches（经沙盒 bridge 到
      endpoint 得 HTTP 状态）、egress-direct-blocked（直连 IP ENETUNREACH）、egress-dns-blocked（外域
      DNS EAI_AGAIN）、zero-residue（探针后 0 bridge/0 container）、secret-scan-power（植入命中=1、干净=0）；
      preflight.json 另记 historicalPreflightFailures（bwrap userns 被 apparmor 挡、误读全局 wrapper 的
      provider 越界），不进有效 run 分母。
    tags: [cli]
  - name: pilot-check-suite
    description: >
      从仓库根运行 run.ts pilot check，捕获 exit code 与 runs/pilot/check.json。付费前必过的无模型
      回归+正负对照套件。
    expected: >
      exit 0：usage-aggregation-regression（cumulative snapshot 不双计、非单调 fail-loud、缺失字段保留
      前值）、scorer-controls-discriminate（spec-lint 行为 scorer 正控 3/3 通过、负控=pre-state fs-walk
      lint 被拒 1/3）、frame-select/episodes/tasks 字节重现、dry-oracle、cards-hash-binding（task-cards
      sha 匹配 tasks.json pin）、provenance-pinned（docker image id + claude 版本/包 digest 记录）全绿。
    tags: [cli]
  - name: pilot-reconstruction-run
    description: >
      【付费，等人批预算+preflight/pilot check 全绿后才测】run.ts pilot phase --scale leaf：对有真实行为
      scorer 的 leaf（spec-lint）重建 R0（隔离 Claude Code + GLM-5.2 via BigModel endpoint，fresh HOME/独立
      CLAUDE_CONFIG_DIR，docker --network none + unix-socket bridge 唯一出口，快照只读、.spec-recon 可写），
      再对该 leaf 跑同一冻结 future task 的 O0/R0/N0 executor（counterbalanced 顺序，臂只差中性投影 bundle）。
      无真实行为 scorer 的 leaf（mobile-ui 异步竞态需真浏览器 YATU）gate 出付费阶段记为盲区。
    expected: >
      spec-lint 的 R0 产出结构合法的 .spec-recon（frontmatter + 非空 body，required-file&schema 门通过）；
      每 arm 入表前硬门 r.ok+exit0+realCompletion+accounting-valid+model=={glm-5.2}+secret-clean 全过，否则
      共享 abort 停整批、只让在途收尾归档、不补跑；主 outcome 由工作区外真实行为测试产出（合成 git
      fixture 实跑产出 lint，观察 tracked-only 覆盖 + testGlobs 排除），scope 用 pre/post diff（含删除）；
      每 run 归档 trace（endpoint host、HTTP status/request-id、session id 集、逐字段 token、provenance、
      mount audit、secret-scan 命中数）+ workspace + scorer raw；clean 快照 plant 零复述、R0 对 masked O0
      零 verbatim shingle overlap；失败/gated leaf 如实归档、无 raw stderr/key/env/完整 process dump 入档。
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
