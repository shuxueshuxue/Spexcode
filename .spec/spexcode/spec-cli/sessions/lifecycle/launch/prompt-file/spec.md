---
title: prompt-file
status: active
hue: 280
desc: "`spex new --prompt-file <path>` (or `-` for stdin) reads the task prompt from a file — fail-loud exclusive with the inline prompt, so long multi-paragraph prompts never fight shell quoting."
related:
  - spec-cli/src/cli.ts
  - spec-cli/src/help.ts
---

# prompt-file

## raw source

A real launch prompt is often long and multi-paragraph, and argv is a hostile carrier for it: shell
quoting turns backticks and `$()` into evaluation hazards, so callers end up writing the prompt to a
file anyway and threading it through `"$(cat file)"` (field report: gugu-promo multi-agent
coordination, ~15 workers in one night). The tool should accept the file directly.

## expanded spec

`spex session new` accepts **`--prompt-file <path>`**: the task prompt is
the file's contents, read verbatim by the CLI **before** the create POST — the backend and everything
downstream (launch artifact, `spex session show`) see exactly the same prompt text an inline caller
would have sent; nothing else about [[launch]] changes. `--prompt-file -` reads the prompt from
**stdin**, so `spex session new --prompt-file - <<'EOF' …` works without a temp file.

Fail-loud, never guess:

- **Exclusive with the inline prompt.** Given together with a positional prompt or `--prompt`, the
  command refuses with a one-line usage error (exit 2) — it never silently picks one source.
- **An unreadable path or an empty/whitespace-only file refuses the launch** with a one-line error
  naming the path (exit 2) — an empty prompt via an explicit file is a caller mistake, not a request
  for a promptless session.

`spex help new` advertises the flag alongside the positional form.
