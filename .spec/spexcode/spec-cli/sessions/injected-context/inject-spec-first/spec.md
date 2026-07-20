---
title: inject-spec-first
status: active
hue: 280
desc: A governed-aware PreToolUse read gate — irrelevant and uncovered reads leave it armed; the first governed read blocks once with the actual contract and its neighbors.
code:
  - .spec/spexcode/.plugins/core/spec-first/spec-first.sh
related:
  - spec-cli/hooks/harness.sh
  - spec-cli/templates/spec/project/.plugins/core/spec-first/spec-first.sh
  - spec-cli/src/hook-dispatch.test.ts
---

# inject-spec-first

## raw source

The standing contract already tells an agent to read a file's governing spec before understanding its code
([[core]]), but a standing instruction is easy to scroll past. Catch the first READ whose target actually has
a `code:` governor. An uncovered file has no contract to read, so allowing it must leave the gate armed for a
later governed read. Firing once on the first actionable boundary lands when it counts; firing on every read
would become noise.

## expanded spec

A `PreToolUse` hook (`spec-first.sh`) runs behind the same manifest and dispatcher on every harness. Native
hook shims deliver `PreToolUse` broadly; they do not own product filtering. The shell face of the
[[harness-adapter]] supplies one semantic `read` matcher: Claude's Read payload and Codex's read-shaped Bash
payload reduce to the same file path, while mutations, unrelated tools, and unresolvable commands reduce to
nothing. `spec-first.sh` contains no harness branch.

The path is then resolved through the authoritative spec graph (`spex internal spec-governors`, a stable
machine projection of the same ownership resolver as `spex spec owner`). Only a real `code:` governor is
actionable; uncovered and related-only files are ungoverned. The session sentinel (`spec-checked`,
a sibling of `session.json` under [[runtime]]) therefore has exactly one transition:

- **armed + irrelevant/unresolvable/ungoverned event -> armed, allow silently**;
- **armed + governed read -> spent, block once**, naming the actual governor and requiring its relevant parent,
  siblings, and children before retrying;
- **spent + any later event -> spent, allow silently**.

This file governance is independent of the session record's `governed` bit. Dashboard-launched and
self-launched agents both get the gate, and a self-launched session's store directory is created only when a
governed read actually spends it. A read performed through a command shape the adapter cannot resolve passes
without changing state: the hook is a precise reminder, while the Stop gate remains the enforcer. Its
edit-time twin [[inject-spec-of-file]] keeps governance visible during mutations.
