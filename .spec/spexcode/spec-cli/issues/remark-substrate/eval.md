---
scenarios:
  - name: human-second-party-resolve
    tags: [backend-api]
    code: spec-cli/src/localIssues.ts
    related: spec-cli/src/index.ts
    description: >-
      Against a backend on a disposable store (SPEXCODE_ISSUES_DIR), author remarks from BOTH surfaces:
      agent remarks via the CLI (`spex remark`, a real session id) and one human remark via POST
      /api/remarks. Then exercise the resolve/retract teeth over HTTP exactly as the dashboard would:
      resolve the agent's remark; resolve the same ref AGAIN; resolve the human's own remark; retract
      the agent's remark; retract the human's own unresolved remark. Record every status + body as the
      transcript.
    expected: >-
      Identity is surface-derived ('human' on every /api/remarks route — never read from the request
      body), and the SAME R3 rules run on both surfaces (LAW L): the human RESOLVES an agent-authored
      remark (200 — a real second party's judgment, resolvedBy 'human' in the stored thread); a second
      resolve of the same ref is refused (400, monotonic — no un-resolve, no re-resolve); the human
      resolving the HUMAN-authored remark is refused (400, self-resolve); the human retracting the
      AGENT's remark is refused (400, author-only); the human retracting their OWN unresolved remark
      succeeds (200, the reply removed from the thread).
  - name: external-write-freshness
    tags: [frontend-e2e]
    code: spec-cli/src/index.ts
    related: [spec-cli/src/graph.ts, spec-dashboard/src/App.jsx]
    description: >-
      A real browser sits on the dashboard's Issues page with a local thread's detail open (an on-page
      wall clock burned into the recording). A remark then lands on that thread through POST /api/remarks
      — the dashboard-parity write surface — from outside the tab. Record the whole window as video.
    expected: >-
      The write is push-visible: persistence atomically invalidates the board cache and the viewer's
      thread shows the new remark within a couple of seconds (one debounce + rebuild + refetch), never
      waiting for the ~15s cold/fallback lane.
---
# measuring remark-substrate

YATU through the real write surfaces, never the functions in isolation: the CLI verbs
(`spex remark|resolve|retract`, identity = the governed session) and the server routes
(`/api/remarks`, `/api/remarks/resolve`, `/api/remarks/retract`, identity = the `human` sentinel),
both against one disposable store. The HTTP transcript of statuses and bodies IS the reading; the loss
is any who-may rule that differs by transport.
