---
title: hook dispatcher runtime
status: active
hue: 280
desc: The one shell runtime that executes a complete manifest dispatch and preserves native hook blocking output.
code:
  - spec-cli/hooks/dispatch.sh
related:
  - spec-cli/src/hook-dispatch.test.ts
---

# hook dispatcher runtime

## raw source

The compiled manifest needs one executable owner. Dispatching is not merely related to the shell script: this
node governs the exact shell entry every harness invokes, including its scratch-state cleanup.

## expanded spec

`dispatch.sh` resolves the current tree's persistent manifest exactly as [[hook-dispatch]] defines and captures the
event input once before invoking any matching handler. A trap cleans up its per-dispatch scratch state on normal
completion, handler failure, signal, or shell exit.

The same tree slot carries the dispatch-id allowlist from its last successful materialize. A project transport
may remain installed after a selection changes, but an event whose baked harness id is absent from THIS tree's
allowlist exits before any input handling. Before the project migration marker, an absent allowlist is
the one-version legacy shape; afterwards absence is inert until a git-native materialize publishes it.

A missing manifest is a no-op because there is no handler work to run. All matching handlers preserve the
existing deterministic order, stdout concatenation, blocking declaration, and Codex stderr reason translation.

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
