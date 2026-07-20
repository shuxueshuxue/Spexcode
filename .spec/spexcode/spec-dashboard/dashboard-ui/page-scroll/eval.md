---
scenarios:
  - name: shared-page-scroll-desktop
    test: spec-dashboard/test/page-scroll.e2e.mjs
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/PageScroll.jsx]
    related: [spec-dashboard/src/styles.css]
    description: >
      Against a live backend with long real Evals and Issues data, drive Graph, Sessions, Evals list and
      detail, Issues list and detail, Settings, and a real Projects host face in Chromium at 1440px. For
      every face record the page shell, content viewport, overflow owners, scrollbar gutter and
      track bounds, sticky elements, top/middle/bottom scrolling, horizontal overflow, and browser Back
      after opening a middle row. Repeat the document pages through all eight themes and capture video
      with an emitted step timeline plus settled screenshots.
    expected: >
      Every document-shaped face has exactly one `.page-scroll` overflow owner with the same top and
      bottom track inset, stable desktop gutter, and no horizontal overflow; its scrollbar never touches
      the viewport top or bottom. Evals and Issues list/detail, Settings, and Projects share that geometry
      through all themes. Their sticky headers/rails remain contained by that owner, and Back restores
      the exact prior nested scrollTop for the full list address. Graph has no document scrollport,
      Sessions keeps only its list/terminal-local scrolling, and xterm geometry is unchanged.
  - name: shared-page-scroll-mobile
    test: spec-dashboard/test/page-scroll.e2e.mjs
    tags: [frontend-e2e, mobile]
    code: [spec-dashboard/src/PageScroll.jsx]
    related: [spec-dashboard/src/styles.css]
    description: >
      Repeat the routed Graph, Sessions, Evals list/detail, Issues list/detail, and real Projects host
      journey in Chromium at 390px with the same long data. Measure the one-axis overflow owners,
      scrollbar track start/end above the tab bar, sticky-to-flow detail transition, Fail/Pass and Human
      review builders, browser Back restoration, and every document/body/element scroll width. Record the
      top/middle/bottom journey as video with an emitted timeline and settled screenshots.
    expected: >
      Evals and Issues list/detail plus Projects use the same `.page-scroll` contract with equal 10px
      top/bottom track insets and no horizontal overflow. Review pages stop above the mobile tab bar;
      detail metadata is ordinary flow above content, not sticky. Fail/Pass stays a named pressed-button
      group, Human review remains reachable in overflow, and Back restores the exact list position.
      Graph and Sessions remain their purpose-built mobile planes without a document page-scroll wrapper.
---

# measuring page-scroll

YATU through the actual routed pages and host Projects surface. DOM probes explain geometry; screenshots
and whole-flow video prove what the reader sees while moving through it.
