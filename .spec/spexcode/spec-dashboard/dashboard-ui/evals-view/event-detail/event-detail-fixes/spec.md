---
title: event-detail-fixes
status: active
hue: 200
desc: Event detail regression guardrails: eval remark drafts are scoped to the selected (node, scenario), filer/originator chips route to their live session, and eval-page mention outcomes echo like issue replies.
code:
  - spec-dashboard/src/Dashboard.jsx
  - spec-dashboard/src/EventDetail.jsx
  - spec-dashboard/src/EvalsPage.jsx
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/Thread.jsx
related:
  - spec-dashboard/src/IssuesPage.jsx
---
# event-detail-fixes

## raw source

The eval detail workspace is a reviewer surface over one selected scenario. Switching that selection must
change the whole working context, not only the media: a half-authored or circle-prefilled remark belongs to
the old `(node, scenario)` thread and must disappear before another scenario's composer can send it. The
shared thread composer is allowed to keep local editing state only inside the identity of the selected
thread.

The same surface is also a navigation and dispatch surface. A live filer/originator chip names the session
that filed or opened the thread, so activating it must open that session's console, not the generic new
session route. When a human reply contains a mention that dispatches or summons a session, the resulting
one-line outcome must echo on the Evals page just as it does on the Issues page; a summon is never silent.

## expanded spec

The event detail and shared thread components treat selection identity as part of composer state. Clearing
or changing the selected eval clears the composer body and any staged draft so anchored text, circled-frame
markdown, and evidence links cannot cross from one eval thread into another. The reset is keyed by the
server-facing thread concern, not by visual row position, so walking the feed, deep-linking, or flipping
between eval homes preserves the invariant.

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
