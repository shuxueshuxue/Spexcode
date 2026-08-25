---
scenarios:
  - name: a-dash-leading-prompt-is-delivered-not-parsed
    tags: [cli]
    code: [spec-cli/src/sessions.ts#launchScript]
    description: >
      Launch and send prompts that begin with `-`, with `--`, and with the literal resume marker each launcher
      script recognizes, on more than one harness; read the generated launch script and what the agent received.
    expected: >
      No prompt reaches an argv position where its first character can be read as machinery: the guarantee is
      made once at this seam, the delivered text carries the human's words byte-for-byte after at most one
      leading space, and no launch path contains a per-harness prompt escape or a `if (harness)` branch.
---
# measuring prompt-operand

The measurement drives more than one harness on purpose: the point of the seam is that none of them needs its own answer.
