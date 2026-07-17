---
concern: portable-layout: malformed spexcode.local.json 使 trunk 解析回落到常量 'main' 而非 auto-detect -m 场景 committed-plus-local-overlay 第4步的期望是:配置文件坏了时,trunk 解析的 plumbing 面(spex internal trunk = layout.ts mainBranch())降级为 auto-detect。实测(worktree 与 main 工具链均复现):repo 分支 devel,无配置时 auto-detect 正确打出 devel;写入 malformed 的 spexcode.local.json 后打出 main——回落到了硬常量而不是 auto-detect。fail reading 已归档于 portable-layout/committed-plus-local-overlay(transcript 含完整复现)。[[portable-layout]]
by: 38f46ce9-1601-4f7e-88cf-700ad6e1e35d
status: open
nodes: portable-layout
created: 2026-07-17T05:09:55.124Z
---

(no detail given — portable-layout: malformed spexcode.local.json 使 trunk 解析回落到常量 'main' 而非 auto-detect -m 场景 committed-plus-local-overlay 第4步的期望是:配置文件坏了时,trunk 解析的 plumbing 面(spex internal trunk = layout.ts mainBranch())降级为 auto-detect。实测(worktree 与 main 工具链均复现):repo 分支 devel,无配置时 auto-detect 正确打出 devel;写入 malformed 的 spexcode.local.json 后打出 main——回落到了硬常量而不是 auto-detect。fail reading 已归档于 portable-layout/committed-plus-local-overlay(transcript 含完整复现)。[[portable-layout]])
