---
title: page-scroll
status: active
hue: 200
desc: The ONE full-page scrollport contract shared by every document-shaped dashboard surface: inset scrollbar geometry, stable gutter, sticky containment, address-keyed restoration, and phone parity without stealing Graph, terminal, or pane-local scrolling.
code:
  - spec-dashboard/src/PageScroll.jsx#PageScroll
related:
  - spec-dashboard/src/Dashboard.jsx
  - spec-dashboard/src/MobileApp.jsx
  - spec-dashboard/src/ReviewShell.jsx
  - spec-dashboard/src/Settings.jsx
  - spec-dashboard/src/ProjectsPage.jsx
  - spec-dashboard/src/styles.css
  - spec-dashboard/src/pageScroll.test.mjs
  - spec-dashboard/test/page-scroll.e2e.mjs
---

# page-scroll

## raw source

Document-shaped dashboard pages share one visible scrollbar geometry. The scroll track starts below the
shell edge, stops above the bottom edge, keeps a stable gutter, and returns to the exact place a reader
left when browser history brings that address back. A page supplies content; it never invents another
full-page overflow owner.

## expanded spec

`PageScroll` is the one overflow owner for Evals and Issues lists/details, Settings, and the global
Projects page. The shell owns its available viewport; the primitive owns the top/bottom track inset,
desktop end inset, stable gutter, vertical overscroll containment, and horizontal clipping. Content owns
its width and padding. Sticky children such as the review list header, detail side rail, and composer pin
inside this scrollport, so their geometry follows the same viewport instead of the browser document or a
page-local scroller.

Scroll position is remembered by the full canonical address. When returned content already has its final
height the primitive restores before paint; when a long list arrives asynchronously, it preserves the
saved target across the browser's temporary zero clamp and restores as soon as the content can represent
that position. Pointer, wheel, touch, or keyboard input ends automatic restoration so user intent wins.
List to detail is still an ordinary PUSH and browser Back still owns navigation; the primitive only
restores the nested scrollTop belonging to the returned address. Different query states keep different
positions. A new address starts at the top, and a hidden warm page keeps its own native state.

The Graph canvas and Session console do not consume this primitive: the graph camera is not document
scroll, the session list is a bounded pane, and xterm/tmux owns terminal scrollback. Popup, side-rail,
composer, and mobile timeline scrollers remain local where their contracts require them. At phone width
the same review pages consume the same primitive above the tab bar, with equal top/bottom track insets,
no horizontal page overflow, and the detail rail returned to ordinary document flow.
