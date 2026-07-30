---
scenarios:
  - name: passive-session-reference
    tags: [backend-api]
    code: spec-cli/src/index.ts
    related: [spec-cli/src/mentions.ts]
    description: >-
      Start a real backend with the no-model fake harness, create two online sessions A and B, then submit
      `@<B-id> inspect this context` through A's Command Box API. Read both live PTY captures.
    expected: >-
      The authored text reaches A exactly once, while B receives no prompt, poke, spawn, or mention outcome.
      `@<B-id>` is a passive, discoverable session reference for the receiving session to use with an
      explicit `spex session send` or `/distill`; mentioning it never contacts B by itself.
  - name: parse-references
    tags: [cli]
    code: spec-cli/src/mentions.ts
    description: >-
      Call parseMentions on text mixing @session, an offline-session id, repeated session references, and
      [[node]] refs.
    expected: >-
      Session references and nodes are deduped in first-seen order (@ only at word boundaries, [[id]] for
      nodes). Parsing never resolves a harness, spawns a worker, or makes a delivery decision; offline and
      completed ids are valid references.
  - name: issue-reference-wiring
    tags: [cli]
    code: spec-cli/src/mentions.ts
    related: [spec-cli/src/localIssues.ts]
    description: >-
      Through the real CLI, post an issue reply/thread whose body @-references a session and also writes a
      [[node]] ref, in a repo with both online and offline sessions.
    expected: >-
      The post commits with both references verbatim. Neither an online nor an offline @session receives a
      prompt or changes state; the [[node]] ref remains passive too.
  - name: cjk-node-id
    tags: [frontend-e2e]
    code: spec-cli/src/mentions.ts
    related: [spec-cli/src/sessions.ts, spec-dashboard/src/mentions.jsx]
    description: >-
      Against a project holding a CJK-id node and an ASCII-id control, drive the real dashboard composer:
      type [[, filter the dropdown by a CJK char, pick the CJK node, and launch; repeat with ASCII.
    expected: >-
      One grammar regardless of script: a CJK query filters like ASCII, and the chosen [[id]] binds the
      launched session exactly like the ASCII control.
  - name: cli-sigil-tolerance
    tags: [cli]
    code: spec-cli/src/mentions.ts
    related: [spec-cli/src/sessions.ts, spec-eval/src/cli.ts]
    description: >-
      Through the real CLI, name the same referent with and without its sigil as a session selector and a
      node argument.
    expected: >-
      A sigiled CLI argument resolves exactly like its bare counterpart without widening a match. Sigils stay
      required in free text.
---

# measuring mentions

YATU through the real mentions module, the real `spex issue`/`spex remark` CLI, and the Command Box API. The
pure grammar is measured directly on the exported parser; storage wiring proves references stay verbatim. The
fake-harness two-session scenario is the regression boundary: an online referenced worker receives no prompt
while the selected session receives the authored text.
