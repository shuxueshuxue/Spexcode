---
scenarios:
  - name: launch-fires-in-the-background-and-the-box-stays-yours
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/SessionInterface.jsx#LauncherPicker]
    description: >
      Open New Session, type `/<preset> [[node]] free text`, pick a launcher from the pop-out, press the launch
      button, and immediately type again; read focus, the draft, the selected document, and the POST body.
    expected: >
      The draft clears at once and focus never leaves the box (it is never disabled); the POST carries only
      `launcher` plus the raw grammar; the pending document is selected and shows the shared spinner until its row
      arrives; the picker is the only launch choice and its remembered pick survives a reload.
  - name: scoped-settings-adds-harness-target
    tags: [frontend-e2e, backend-api, desktop]
    test:
      path: spec-dashboard/test/scoped-harness-target.e2e.mjs
      name: scoped Settings adds a built-in harness target
    code: [spec-dashboard/src/Settings.jsx, spec-dashboard/src/launch.js, spec-dashboard/src/projects.js]
    description: >-
      In a scoped dashboard session, open Settings and use the Harness delivery section. Read the project config,
      choose an unselected built-in target, submit, and observe the host response and refreshed launcher data.
      Exercise a stale revision through the same Settings control.
    expected: >-
      New Session has no configuration or add control; its pop-out links to Settings. Settings loads the current
      revision, shows only built-in targets, posts the selected target to the host, and refreshes launcher data
      after a successful materialize. Revision conflicts remain visible and no unscoped session path gains a
      host-only control.
---
# measuring new-session-tab

The claim is about the human's hands during a slow launch, so the measurement types through the launch window.
