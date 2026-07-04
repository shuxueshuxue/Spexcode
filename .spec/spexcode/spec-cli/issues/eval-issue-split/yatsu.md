---
scenarios:
  - name: eval-remarks-split-from-issues
    tags: [frontend-e2e]
    description: >
      On the #/issues page (the Issues page), read the concerns of every listed issue. Then open the
      #/evals page (the Evals page), select an eval reading whose (node, scenario) has at least one remark,
      and read the RIGHT detail pane's remark thread. Cross-check against the store: an `eval: <node> ·
      <scenario>` thread exists on disk for the selected reading.
    expected: |
      The Issues page (#/issues) lists ONLY real issues — NO row whose concern begins `eval: ` appears
      (eval-remark threads are split out of mergedIssues by isEvalConcern, so no issue surface counts
      them). The SAME eval thread that is absent from the Issues page IS present in the eval detail on the
      Evals page (#/evals): selecting the eval reading renders its remark thread (the `eval: <node> ·
      <scenario>` thread, folded in as entry.thread), each remark showing its resolved/open state. The one
      store feeds two complementary reads: issue surfaces exclude the eval concerns, the eval detail keeps
      only them.
  - name: remark-from-detail-composer
    tags: [frontend-e2e]
    description: >
      On the #/evals page, select an eval reading, type a comment in the detail pane's composer and
      Send. Read the network call and the re-rendered thread. Then repeat in the SESSION eval tab (a
      session's proof → Eval) for one of its readings.
    expected: |
      The composer POSTs to /api/remarks with { node, scenario, body } (never a plain /api/issues reply) —
      the CLI-parity remark write; the server find-or-creates the (node, scenario) thread and appends the
      remark (identity server-derived 'human'). After the board/model refresh the new remark appears in the
      thread as an OPEN remark. The session eval tab renders the SAME EventDetail — full media + remark
      thread + live composer — with no "no resident issues list" degradation: authoring a remark there
      lands identically.
---
# eval-issue-split — yatsu

The milestone's loss is the **split staying clean** and the **one component staying unified**. The first
scenario measures the read-time split end to end through the real browser: an eval-remark thread must be
absent from every issue surface (the Issues page list standing in for `mergedIssues`) yet present in the eval
detail (the M2 overlay) — the two complementary reads over one store. The second measures U1 + L: the
detail composer authors a **remark** through the CLI-parity `/api/remarks` on BOTH homes (the Evals page and
the session tab), so the dashboard adds no capability and the session tab's old degradation is gone.
