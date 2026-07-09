---
scenarios:
  - name: fail-loud-intake
    tags: [cli]
    description: >
      Through the real CLI, hit every refusal seam of `spex new --prompt-file`: (a) an inline prompt AND
      `--prompt-file` together, (b) a nonexistent path, (c) an empty file, (d) `-` with empty stdin. None
      of these may reach the backend — each must refuse before the create POST.
    expected: |
      All four exit 2 with a one-line `spex new:` error on stderr and no session created: (a) names the
      either/or conflict without picking a source, (b) names the unreadable path, (c)/(d) name the empty
      file (or stdin) and refuse the promptless launch. No silent fallback to the other prompt source.
    code: spec-cli/src/cli.ts
  - name: file-prompt-roundtrip
    tags: [cli, backend-api]
    description: >
      Write a multi-paragraph prompt file deliberately loaded with the shell hazards the flag exists to
      dodge (backticks, `$()`, `$VAR`, mixed quotes), launch a real session with
      `spex new --prompt-file <file>` through the running backend, then read the session's recorded
      originating prompt back (`spex session prompt <id>`) and byte-compare it to the file. Close the
      probe session after.
    expected: |
      The launch succeeds and the readback is byte-identical to the file — every hazard character intact,
      no shell evaluation, no truncation. The created-session JSON on stdout carries the same prompt text
      an inline caller would have sent.
    code: spec-cli/src/cli.ts
---

# prompt-file — yatsu

Measured through the real `spex` CLI as a user types it — never by unit-calling the parser. The loss
being scored is intake honesty: the file/stdin prompt arrives verbatim at the same create path as an
inline prompt, and every ambiguous or empty intake refuses loud before anything launches.
