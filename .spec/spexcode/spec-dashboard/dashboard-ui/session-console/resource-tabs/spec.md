---
title: resource-tabs
status: active
hue: 280
desc: A session's published files and web services open as file-class workspace tabs beside the session document — warm browser instances with no cross-session pool — never as an overlay that replaces the terminal or conversation.
code:
  - spec-dashboard/src/SessionInterface.jsx#SessionResourcePanel
related:
  - spec-dashboard/src/sessionSurface.js
  - spec-cli/src/session-files.ts
  - spec-cli/src/session-web.ts
  - spec-dashboard/test/session-web.e2e.mjs
---

# resource-tabs

What a session publishes ([[files]] / [[web]]) is reachable from the [[session-console]] as ordinary workspace
tabs. This node owns how those tabs are opened, kept warm, focused, refreshed, and closed, and the boundary that
keeps them from ever covering the session's own face.

Opening a published resource is an ORDINARY navigation to that address: it appends a file-class workspace tab
while the session object tab and its selected Terminal/Conversation face remain untouched ([[tab-strip]]). The
resource never replaces the session document's main face; closing it returns to the held session tab and its
warm terminal/PTY. It used to overlay the session page and force a tab hunt to get back, which is exactly the
"把我的终端和 conversation 页直接覆盖掉了…太诡异了" regression this boundary prevents. The dock's sessions
projection remains a free return to any session.
The resource tab is a pinned hold from birth, so later file navigation cannot evict it; only its close action
removes that held workspace object.
The dock's sessions projection is the always-present free return to the session and never destroys its tmux/PTY.

The plus lists the selected session's posted
files and loopback web services ([[files]] / [[web]]) that are not already open. Selecting one creates one
browser-local tab for that exact session/reference; closing it removes only that view and permits reopening from
the plus menu, never a duplicate. Clicking a filename in the top-right files dropdown uses this same open/select operation for its
file row, so it cannot create a separate preview surface or a duplicate tab. A newly observed posted web service
never creates or selects a visible tab automatically. It raises the existing unread signal; clicking that signal is
the user gesture that opens/focuses its one address tab. Each resource tab exposes a close icon and a right-side **refresh** action:
for a file it rereads the current preview response, while for a web resource it recreates the same-origin iframe and
requests the current local-service response. A selected file also gets **download** and **copy path**, the same actions
offered by the files dropdown; those file-specific actions do not appear for a web resource. Removing a published
reference closes its resource tab. An open resource tab is a **warm browser instance**, not merely the selected
surface: its file preview request or same-origin iframe stays mounted, including its scroll position and page state, while
another resource, Terminal/Conversation, another session, or another routed page is selected; returning makes that same DOM
instance visible rather than rereading or reloading it. Its lifetime is anchored to its live session, not its selected state:
only the tab's explicit close, reference retraction, or session retirement releases it. Resource tabs and that session's warm
terminal share this ownership boundary: there is **no cross-session resource-tab pool, admission limit, or eviction**. A global
budget lets one live session starve another while terminals themselves remain unbounded; a per-session quota would still make a
session's resources shorter-lived than its terminal for no product reason. Each session may therefore retain every resource tab it
opens during that session's lifetime, independently of every other session. A selected resource tab is a
temporary browser-local overlay of that session's base surface: closing it, pressing the base tab, or Esc from
the resource returns to the same Terminal/Conversation base without changing that preference. The diff face is
an overlay on the same terms — Esc and its own lit door both return to the bare address. The browser
persists the pane-backed base choice per session and project; a session without an explicit choice resolves the
Settings default, then Terminal. Switching sessions may restore its still-open resource overlay, but resource
selection is never persisted or written to the session/backend, and a bare session address always opens the
persisted base rather than whatever overlay was last on screen. 

A selected resource tab
replaces either base surface with a bounded, top-anchored selectable file preview or same-origin web frame; Markdown
uses the same restricted renderer as other dashboard prose while raw HTML remains text. File text is the explicit
native-selection exception to the panel's pointer-inert chrome, so drag and Ctrl/Cmd+C work while its non-focusable
surface leaves the current terminal/composer sink alone. The inactive terminal layer is hidden
and pointer-inert, preserving its warm transport. A selected **web** resource is its own input sink: on every selection
(the picker, its tab, automatic opening for the selected session, or restoring that session's local surface) focus enters its
same-origin iframe without an in-page click, so ordinary keys including arrows belong to the published page immediately. The
dashboard's reserved controls stay reachable: its documented Alt chords relay back to the console, and Escape first peels the
shared [[esc-layers]] top layer (including the open resource picker); only when that stack is empty does it return to the session's Terminal/Conversation sink. Thus a
web frame cannot lock the dashboard controls, and one Escape never skips an overlay to switch the resource surface underneath it.
