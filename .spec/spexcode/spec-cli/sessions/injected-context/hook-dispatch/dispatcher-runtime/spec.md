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

The same tree slot carries the dispatch-id allowlist from its last successful materialize. A project transport
may remain installed after a selection changes, but an event whose baked harness id is absent from THIS tree's
allowlist exits before admission or input handling. Before the project migration marker, an absent allowlist is
the one-version legacy shape; afterwards absence is inert until a git-native materialize publishes it.

Draining or active maintenance withholds EVERY manifest handler, including spec-discipline handlers. The
dispatcher emits structured `maintenance_active` through the harness's native blocking channel and exits with
the harness block status; it runs zero handler scripts and produces no handler file, record, sentinel, ledger,
stdout, or event side effect. A missing manifest remains a no-op because there is no handler work to admit.
Outside maintenance, all matching handlers run under the one live ticket and preserve the existing deterministic
order, stdout concatenation, blocking declaration, and Codex stderr reason translation. Non-hook reads are not
this runtime's responsibility and remain open.

### Known-corrupt mark-active compatibility

The original shipped `core/mark-active` script treated its note as text safe to substitute into JSON. Its own
comment asserted that a note never contains a double quote, but neither the declaration nor the harness payload
enforced that assertion; a quote therefore closed the JSON string and made a live record unreadable. Existing
projects track their seeded `.plugins` source, and `spex materialize` deliberately renders that source rather
than overwriting it. Updating the global package alone would otherwise leave a frozen worktree executing the
bad script.

The dispatcher has one narrow, package-owned compatibility route: when the manifest names the standard
`.spec/project/.plugins/core/mark-active/mark-active.sh` path **and that file byte-compares equal to the
identified vulnerable shipped revision**, it executes the package's current structured `mark-active` implementation
instead. It does not edit the project file, its manifest, or any session record before that implementation runs.
Any byte difference, including a project customization, executes the project script exactly as the manifest
requested. This is an emergency execution override, not a plugin updater: a project moves its tracked source to
the current template only in its own reviewed maintenance change. The compatibility entry remains only for the
identified broken revision; a new project hook never enters this route.
