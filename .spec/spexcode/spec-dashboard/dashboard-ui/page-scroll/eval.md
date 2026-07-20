---
scenarios:
  - name: shared-page-scroll-desktop
    test: spec-dashboard/test/page-scroll.e2e.mjs
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/PageScroll.jsx]
    related: [spec-dashboard/src/styles.css]
    description: >
      Against a live backend with long real Evals and Issues data, locate details whose real rendered
      content exceeds the desktop viewport, then drive Graph, Sessions, trunk and session-scoped Evals
      lists, those long Evals/Issues details, Settings, and a real Projects host face in Chromium at 1440px. For
      every face record the page shell, content viewport, overflow owners, scrollbar gutter and
      track bounds, sticky elements, top/middle/bottom scrolling, horizontal overflow, and browser Back
      after opening a middle row. Preserve the real scoped model and require its real declared-but-never-
      measured rows to exercise Fail/Pass, Human review and count stability.
      On the scoped list also record the terminal/gates strip's stable geometry, opaque shared-token paint,
      content occlusion, and 10px sticky inset; open Secondary Filters and tooltips over the pinned strip,
      then verify Back restores its nested scroll position. Repeat every document page through all eight themes and capture video
      with an emitted step timeline plus settled screenshots.
    expected: >
      Every document-shaped face has exactly one `.page-scroll` overflow owner with the same top and
      bottom track inset, stable desktop gutter, and no horizontal overflow; its scrollbar never touches
      the viewport top or bottom. Evals and Issues list/detail, Settings, and Projects share that geometry
      through all themes. Scoped gates are the opaque sticky first child inside the same owner: they stay at
      its 10px top inset through top/middle/bottom, do not move its track start or reveal rows through their
      paint, and stay below Filters/tooltips. Trunk Evals contributes no empty strip; Issues and the detail
      side sticky retain their geometry. A browser-native history write that arrives after the layout
      restore cannot replace the saved target: it must survive a paint before restoration yields; an
      asynchronously growing list keeps the target pending until its scroll height can represent it.
      Pointer, wheel, touch, or keyboard input cancels that pending restoration and the user's new position wins.
      Fail/Pass is strictly non-exhaustive when real blind rows exist, and its counts remain stable when
      its own token toggles under Human review. Long-detail scrolling pins sticky rails inside that owner,
      and Back restores the exact prior nested scrollTop for the full list address. Graph has no document scrollport,
      Sessions keeps only its list/terminal-local scrolling, and xterm geometry is unchanged.
  - name: shared-page-scroll-mobile
    test: spec-dashboard/test/page-scroll.e2e.mjs
    tags: [frontend-e2e, mobile]
    code: [spec-dashboard/src/PageScroll.jsx]
    related: [spec-dashboard/src/styles.css]
    description: >
      Repeat the routed Graph, Sessions, Evals list/detail, Issues list/detail, direct Settings, and real Projects host
      journey in Chromium at 390px with the same long data. Measure the one-axis overflow owners,
      scrollbar track start/end above the tab bar, sticky-to-flow detail transition, Fail/Pass and Human
      review builders, the scoped gates' two-line stable-height sticky geometry and first-row clearance,
      the open Filters menu over that strip, browser Back restoration, and every document/body/element scroll width. Record the
      top/middle/bottom journey as video with an emitted timeline and settled screenshots.
    expected: >
      Evals and Issues list/detail, Settings, and Projects use the same `.page-scroll` contract with equal 10px
      top/bottom track insets and no horizontal overflow. Review pages stop above the mobile tab bar;
      the scoped status strip stays pinned at the 10px inset in exactly two contained lines, never covers
      the first row or shows it through the strip, and remains below Filters/tooltips. Detail metadata is
      ordinary flow above content, not sticky. Fail/Pass stays a named pressed-button
      group, Human review remains reachable in overflow, and Back restores the exact list position after
      async rows arrive; a real wheel/touch/key gesture during restoration takes ownership immediately.
      Graph and Sessions remain their purpose-built mobile planes without a document page-scroll wrapper.
---

# measuring page-scroll

YATU through the actual routed pages and host Projects surface. DOM probes explain geometry; screenshots
and whole-flow video prove what the reader sees while moving through it. Each viewport scenario emits its
WebM and timeline as the only pair in its own directory, so the review splitter cannot cross-pair desktop
and mobile recordings.
