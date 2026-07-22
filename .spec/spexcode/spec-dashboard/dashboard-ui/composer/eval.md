---
scenarios:
  - name: shared-composer-shell
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/command-box.e2e.mjs
    code: spec-dashboard/src/Composer.jsx
    related: [spec-dashboard/src/Thread.jsx, spec-dashboard/src/SessionInterface.jsx, spec-dashboard/src/styles.css]
    description: >-
      In a real browser open an issue reply, an eval remark, and a live session Command Box. Compare their
      editor DOM, idle floor, multi-line growth, action-footer position, focus treatment, and IME Enter behavior.
    expected: >-
      All three use the same composer shell and auto-growing textarea primitive: a quiet single border around
      a borderless editor, a useful idle floor, bounded upward growth, and a footer that stays at the surface's
      bottom. Each home retains its own actions and send semantics. An IME composition Enter never submits.
---

Measure through the real dashboard surfaces. Component source similarity is not product evidence.
