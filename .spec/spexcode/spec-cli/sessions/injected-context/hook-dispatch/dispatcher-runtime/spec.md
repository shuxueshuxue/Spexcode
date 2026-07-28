---
title: hook dispatcher runtime
status: active
hue: 280
desc: The one shell runtime that holds a maintenance operation ticket across a complete manifest dispatch and preserves native hook blocking output.
code:
  - spec-cli/hooks/dispatch.sh
related:
  - spec-cli/src/hook-dispatch.test.ts
  - spec-cli/src/session-maintenance.integration.test.ts
---

# hook dispatcher runtime

## raw source

The compiled manifest needs one executable owner. Dispatching is not merely related to the shell script: this
node governs the exact shell entry every harness invokes, including its maintenance admission and cleanup.

## expanded spec

`dispatch.sh` resolves the current tree's persistent manifest exactly as [[hook-dispatch]] defines, captures the
event input once, and enters one [[maintenance-lease]] `hook-state` scoped operation BEFORE invoking any matching
handler. The ticket owner is the dispatcher process's exact PID/start identity and the ticket lives for the
whole ordered handler loop. A trap releases it on normal completion, handler failure, signal, or shell exit.

Draining or active maintenance withholds EVERY manifest handler, including spec-discipline handlers. The
dispatcher emits structured `maintenance_active` through the harness's native blocking channel and exits with
the harness block status; it runs zero handler scripts and produces no handler file, record, sentinel, ledger,
stdout, or event side effect. A missing manifest remains a no-op because there is no handler work to admit.
Outside maintenance, all matching handlers run under the one live ticket and preserve the existing deterministic
order, stdout concatenation, blocking declaration, and Codex stderr reason translation. Non-hook reads are not
this runtime's responsibility and remain open.
