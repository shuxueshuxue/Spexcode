---
title: event-detail-fixes
status: active
hue: 200
desc: Event detail regression guardrails: eval remark drafts are scoped to the selected (node, scenario), filer/originator chips route to their live session, and eval-page mention outcomes echo like issue replies.
code:
  - spec-dashboard/src/evalsPage.test.mjs
related:
  - spec-dashboard/src/Dashboard.jsx
  - spec-dashboard/src/EventDetail.jsx
  - spec-dashboard/src/EvalsPage.jsx
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/Thread.jsx
  - spec-dashboard/src/IssuesPage.jsx
---
# event-detail-fixes

## raw source

The eval detail workspace is a reviewer surface over one semantic review identity: source scope,
`(node, scenario)`, and the currently viewed reading. Local composer state belongs to that whole identity,
not merely to the server-facing remark thread. An unrelated board repaint preserves it; changing scope,
scenario, or A/B reading clears ordinary and anchored drafts before another context can send them.

The same surface is also a navigation and dispatch surface. A live filer/originator chip names the session
that filed or opened the thread, so activating it must open that session's console, not the generic new
session route. When a human reply contains a mention that dispatches or summons a session, the resulting
one-line outcome must echo on the Evals page just as it does on the Issues page; a summon is never silent.

## expanded spec

The event detail derives one review identity from source scope + node/scenario + viewed reading and uses it
as the shared composer's lifetime. A board poll/SSE repaint that recreates props but names the same identity
preserves A/B position, timeline, ordinary prose, and anchored prefill. A real scope, scenario, or A/B-reading
change remounts the composer and clears every child-local draft; returning to an earlier scenario starts
empty rather than reviving a cached draft. The server-facing thread concern still routes writes, but is not
wide enough to govern reading- or scope-local editing state.

Live session chips route to `#/sessions/<session-id>` for the specific session they name. The session page
honors that param before echoing its own selected tab back into the URL, and a valid session remains
selectable even when its row is currently hidden under a collapsed nesting parent; visibility is a navigation
list concern, not a validity test. Offline or unresolved identities remain labels. The destination is the
same route used by the Issues page and session board, keeping originator and filer chips as direct doors back
to the running work.

The Evals page handles write outcomes from the shared event detail exactly like the Issues page handles
thread replies: after a successful write it refreshes the board and briefly flashes any mention outcome the
server returned. This is host responsibility; the shared detail pane emits the write result and does not
own page-level notices.

The source-contract guardrail pins the cross-module boundaries behind these flows: session-scoped history
keeps a stable identity across board-only repaints; the composer reads one scope/scenario/reading identity;
failed session models stay distinct from genuine missing objects; and the desktop shell's session-opening
callback selects and routes without touching retired Eval view state. Browser YATU remains the product proof;
the contract test catches state leaks and deleted-state references before they reach a reviewer.
