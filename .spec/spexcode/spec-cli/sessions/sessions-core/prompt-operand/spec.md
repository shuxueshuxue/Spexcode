---
title: prompt-operand
status: active
hue: 280
desc: The text handed to an agent never begins with `-` — one guarantee made where every launch and send already passes, so no launch path carries a per-harness prompt escape.
code:
  - spec-cli/src/sessions.ts#launchScript
related:
  - spec-cli/src/harness.ts
  - spec-cli/src/sessionSlug.test.ts
  - spec-cli/src/sessions.ts
---

# prompt-operand

Human prompts legitimately begin with a dash — a pasted console line, a diff hunk, a quoted flag — and downstream
that first character decides whether the text is read as a prompt or as machinery. Every harness parses its own
argv by its own rules, so the answer is made ONCE here rather than once per adapter.

The prompt seam carries ONE invariant for every harness: **the text handed to an agent never begins with `-`**.
Human prompts legitimately do — a pasted browser-console line, a diff hunk, a quoted flag — and downstream that
first character decides whether the text is read as a prompt or as machinery. Each harness parses its own argv
by its own rules (one honours an end-of-options `--`, one silently drops a detached value starting with `-`,
one has no end-of-options branch at all), and the launch scripts additionally recognize their resume/continue
markers by comparing the tail to a literal flag. Answering that per harness would mean an escape per adapter
plus a refusal for whichever harness has none — several answers to one question, and still nothing covering a
prompt that IS the literal marker. So the guarantee is made once, here, where every launch and every send
already passes through, and everything downstream hands over one plain quoted operand knowing nothing about
who parses it. The cost is a single leading space on the prompts that would otherwise be undeliverable, with
the human's own words following byte-for-byte; the alternative was refusing to carry them at all. This is why
no `if (harness)` and no per-adapter prompt escape exists in the launch path ([[harness-adapter]]).
