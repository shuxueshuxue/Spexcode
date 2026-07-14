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
      2 leaf future tasks（spec-lint→episode 185f52b1 preState a02fe430、mobile-ui→episode db80b33d
      preState 3f07397f），即每 leaf 取 first-parent 序最早可回放 eligible episode（机械 replay 排除
      依赖同 episode 新建兄弟模块的候选）——三个冻结文件从各自 pinned 输入字节级重现，任何不重现立刻
      非零退出。
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
      前值）、scorer-controls-spec-lint（行为 scorer 正控=committed post-episode lint 3/3 通过、负控=
      pre-state fs-walk lint 被拒）、scorer-controls-mobile（docker --network none 内 browser/DOM 双
      harness——race 用 poll 页、single-refresh 用独立 no-poll 页断言恰 1 个 in-flight——正控=committed
      post-episode App.jsx 3/3，unchanged pre-state 与 never-updates 伪实现两个负控均被拒）、
      registry-fake-e2e（fake executor row 以统一 runner contract 走真实 verifyModel→verify.json→
      verifyAdmitted 门：admit/混 executor 拒/provenance 失配拒/失败 verify 拒；每次 gate 唯一新档 +
      gate-ledger 指向 exact archive + latestVerify 按 provider 取最新；--reviewer-go 只被 verify 接受
      且传达 row，codex 无 GO 在 auth 前拒，phase CLI 拒收该 flag；codex scratch dead-pid sweep/
      零残留断言/rm 失败 fail-loud 亦入 codex selftest；serial-first scheduler 回归——冻结展平序、
      maxInFlight==1、首失败停后续 skipped 入档、每 launch 后 pid 零残留）、codex-auth-binding
      （network-none 容器内真实 codex CLI 对 loopback 假 Responses endpoint：Authorization 恰为 TOML
      env_key 声明注入的 dummy key、body model==gpt-5.5、path=/v1/responses）、
      frame-select/episodes/tasks 字节重现、dry-oracle、cards-hash-binding（task-cards sha 匹配
      tasks.json pin）、provenance-pinned（docker image id + claude 版本/包 digest 记录；scorer 镜像
      每次评分重验 immutable id，且 node/chromium/node_modules/driver 等 mutable 只读挂载逐 launch
      内容摘要并对首钉复核）全绿；check.json 落盘 controlProvenance（两 scorer 的 image id+mount
      digest），供 phase 逐字段绑定。
    tags: [cli]
  - name: pilot-reconstruction-run
    description: >
      【付费，等人批预算 + preflight/pilot check 全绿 + 有效 verify-model 后才测】run.ts pilot phase
      --scale leaf [--executor …]：两个 leaf（spec-lint、mobile-ui）各重建 R0——隔离 executor 一律从
      EXECUTOR_REGISTRY 的 pinned row 启动（默认 ledger activeProvider=codex；GLM/BigModel 行因账号 429
      已退役为 failure artifact），fresh HOME/隔离 config，docker --network none + unix-socket bridge
      唯一出口——再按 tasks.json 冻结的三个 order-balanced blocks 跑 O0/R0/N0 executor（Latin-square 轮转：
      block0 spec-lint O0→R0→N0、block1 mobile-ui R0→N0→O0、block2 mobile-ui repeat N0→O0→R0；repeat
      复用该 leaf 缓存的 recon/bundle，臂只差中性投影 bundle）。
    expected: >
      两 leaf 的 R0 产出结构合法 .spec-recon（frontmatter + 非空 body，required-file&schema 门过）；每 arm
      入表前硬门 r.ok+exit0+realCompletion+accounting-valid+model==active-adapter-pin（GLM=glm-5.2 /
      Codex=gpt-5.5，expected 来自 adapter 常量非参数）+secret-clean 全过；全部 launch 全局串行
      （concurrency=1，冻结 rotation 展平成确定 schedule 入 report，recon 先行、arms 按轮转位交错），
      首个 hard failure 停全部后续、skipped 如实入档、不补跑；主 outcome 由工作区外真实行为测试产出且产出代码不在 host 直跑——
      spec-lint 在 docker --network none 内跑产出 lint（合成 git fixture，tracked-only 覆盖 + testGlobs），
      mobile-ui 用无头 chromium + CDP Network offline 跑产出 App.jsx 驱动 board-poll 竞态（latest-issued 赢、
      stale 丢）+ 独立 no-poll 页的 single-refresh；两者正负 control 均判别（pilot check rc0）；scope 用
      pre/post diff（含删除）；每 run 归档 trace（endpoint host、HTTP status/request-id、session set、逐
      字段 token、provenance image-id/claude-digest、mount audit、secret-scan 命中）+ workspace + scorer
      raw；phase 全部产出先落 staging 树，终扫用同一 fail-closed scanTreeRaw（raw Buffer exact/prefix/
      base64，walk/stat/read/symlink/special/缺根任一错误 hard-stop）以 staging 树自身为 scan root（相对
      路径 rename 前后不变）扫到 counts+scannedFiles+path-set-digest 全稳定——最后一步必是全字节扫描、
      之后零写入才 rename；report 只内嵌 finalArchiveScan（file count/path-set digest/secret summary），
      content digest 记树外 promotion ledger（write-ahead prepare→rename→commit，append 失败 hard-stop）；
      已存在 STAGE/FINAL fail-loud 保留绝不 rm，rename 后验证 source 消失 + destination 存在，否则
      FATAL；失败/gated leaf 如实归档，无 raw stderr/key/env/完整 process dump 入档。
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
transcript 证据（`--result`）与 expected 逐条比对后填 reading。dry-oracle-gates、frames-frozen、
pilot-check-suite 是无凭证无网络可随时重测的面；pilot-preflight-gates 重测需要凭证文件与 endpoint
探测（provider 触碰），在禁触 provider 的阶段它如实保持 stale，与付费门同批人批后重测；
pilot-reconstruction-run 与 blind-forward-scoring 是付费 pilot 的预注册合同——在预算获人工批准并执行
之前，它们保持 missing（unmeasured），这个空缺本身就是诚实的盲区记录，不许用推理或代跑填充。
