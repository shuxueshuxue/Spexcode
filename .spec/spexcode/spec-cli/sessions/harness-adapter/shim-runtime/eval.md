---
scenarios:
  - name: shared-runtime-mechanical
    tags: [cli]
    code: spec-cli/src/shim-runtime.ts
    test:
      path: spec-cli/src/pi-harness.test.ts
      name: whole file
    description: >-
      The embedded runtime is measured through BOTH hosts' generated artifacts:
      `npx tsx --test spec-cli/src/pi-harness.test.ts spec-cli/src/opencode.test.ts` generates the pi
      extension and the opencode plugin, imports each the way its host would, and drives them with stub
      dispatch.sh scripts (clean pass, bare exit-2+stderr, stdout decision:block both as a lone line and
      GLUED to another handler's JSON), fake host APIs, and the REAL deliverViaRendezvous against the
      runtime's own socket server — probe storms included.
    expected: >-
      Every test passes with both generators composing the shared runtime: both hosts read the same verdict
      (blocked = exit 2; reason = stdout JSON → glued regex → stderr → fallback, unescaped, never wire
      JSON), both bind a rendezvous server the real claude deliver parse-confirms against (no duplicate
      injection under a kicking probe storm; an unadopted opencode session reply-rejects before the
      repaint barrier), and every payload reaching dispatch.sh stays claude-shaped with the harness id as
      argv[1].
---
