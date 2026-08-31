---
scenarios:
  - name: the-tab-strip-reads-page-kinds-without-importing-a-view
    tags: [frontend-e2e]
    code: spec-dashboard/src/viewCatalog.js
    related:
      - spec-dashboard/src/views.jsx
      - spec-dashboard/src/tabs.js
      - spec-dashboard/src/TabStrip.jsx
    description: >-
      Against a running dashboard, drive a real browser through the addresses whose tab identity the
      catalog decides: open a spec node, then a second spec node, then the session launch page
      #/sessions/new, then a named session. Read the rendered tab strip after each step — its keys,
      labels, active flag, and whether a tab carries the resident kind icon. Screenshot the end state.
    expected: >-
      Two spec detail addresses share ONE resident Spec tab, because isDocument and isResident answer
      from the catalog and the strip keeps one identity per resident page kind. The launch page adds no
      tab: it names no session, so it is not a document. A named session gets its own tab. A resident tab
      renders its page-kind icon, which the strip reads from the catalog rather than from the module that
      holds the view components — the import that used to close a twelve-module cycle.
---

Measured in a real browser against a real backend, never by reading the module graph. The loss is a tab
strip that disagrees with the registry about what a document is, which is what a second copy of these
predicates would produce.
