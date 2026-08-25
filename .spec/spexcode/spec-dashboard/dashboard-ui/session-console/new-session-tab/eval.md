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
---
# measuring new-session-tab

The claim is about the human's hands during a slow launch, so the measurement types through the launch window.
