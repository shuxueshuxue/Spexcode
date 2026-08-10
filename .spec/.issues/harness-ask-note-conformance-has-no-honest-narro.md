---
concern: harness ask-note conformance has no honest narrow code anchor for the top-level session ask branch
by: fbb76f84-7a73-4262-81d6-9028f5eb7c4e
status: open
nodes: harness-adapter
evidence: 4e99be198265, 4e99be198265f49b354ea61e91966ddeb495194d2e42208853309ddb31f270ca
created: 2026-08-10T07:09:17.854Z
---

Spec: harness-adapter

ask-note correctly belongs in harness-adapter: it proves a real dispatched worker retains its own identity, calls spex session ask --note, and becomes publicly visible. It is not equivalent to directly calling state persistence.

Its current inherited harness.ts axis is wrong, but it cannot be honestly narrowed without source structure: the relevant session ask handler is a top-level `else if (sub === "ask")` in spec-cli/src/cli.ts. `stateKit` ends before that branch and does not cover deletion/regression of the CLI behavior; whole cli.ts is over-broad. The attempted isolated headless YATU did not reach an adapter turn due inherited SPEXCODE_SESSION_ID/resource-gate setup and filed no result.

Resolve by providing a named, anchorable handler boundary for the ask behavior (or another equally narrow source contract), then point this scenario at it and remeasure through a dispatched worker. Do not rehome the scenario, use an incomplete selector, bulk ACK harness stale readings, or change drift semantics.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T08:20:59.560Z -->
Named handler landed on main as 9fe? (merge current); ask-note now anchors spec-cli/src/session-declarations.ts#runSessionDeclaration rather than whole cli.ts. Synced real public measurement split by harness: Claude profile claude-glm (harness=claude) reached asking/online with the exact marker; Codex (harness=codex) accepted send=sent but after about four minutes public show stayed active/working/online with note=null while captured TUI still processed its initial prompt. Fresh fail reading is intentional and exact: codeSha 584c4248d, evidence 4e99be198265. The narrowing problem is resolved; the remaining issue is Codex delivery/execution of the injected ask marker under a busy initial turn. No drift/gate semantics changed.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T08:21:38.820Z -->
Correction to the preceding reply: the named-handler branch landed in main at f2a242042 (not the placeholder text shown there). The fresh failure reading is codeSha 584c4248d8d0c4631cb57e24db4b5147eff14d21 with the attached full transcript. The conclusion is unchanged: source ownership is now narrow and honest; Codex injection/execution remains the separate unclosed behavior.

<!-- reply: fbb76f84-7a73-4262-81d6-9028f5eb7c4e @ 2026-08-10T08:35:11.359Z -->
Correction after source-path review: the Codex FAIL reading has been retracted on main because the marker was injected before the existing ask-note matrix settled precondition. The CLI receipt means only that delivery debt was accepted; it does not prove the harness executed the marker. A real Codex remeasurement must first record stable public settled state and no native in-progress turn, then send and observe. Only a failure under that gate is a Codex product defect. No source behavior is being changed from this diagnosis.
