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
  - name: scoped-new-session-adds-harness-target
    tags: [frontend-e2e, backend-api, desktop]
    test:
      path: spec-dashboard/test/scoped-harness-target.e2e.mjs
      name: scoped New Session adds a harness target and refreshes the launcher picker
    code: [spec-dashboard/src/SessionInterface.jsx, spec-dashboard/src/launch.js, spec-dashboard/src/projects.js]
    description: >-
      In a scoped dashboard session, open New Session and use the plus icon beside the launcher picker.
      Read the project config, choose an unselected native target (then an explicit plugin in a plugin-only
      project), submit, and observe the host response and refreshed picker. Exercise a stale revision and a
      materialize failure through the same modal.
    expected: >-
      The plus control is present only for a scoped project and opens the shared modal without changing the
      prompt. The modal loads the current revision, shows existing targets, prevents duplicate native picks,
      and posts the structured target to the host. A successful native addition refreshes the launcher list
      and selects the new template-backed launcher; a plugin addition remains a delivery target without a
      fabricated launcher. Revision conflicts and materialize failures show the server reason/transcript and
      keep the persisted revision available for retry; no unscoped session path gains a host-only control.
---
# measuring new-session-tab

The claim is about the human's hands during a slow launch, so the measurement types through the launch window.
