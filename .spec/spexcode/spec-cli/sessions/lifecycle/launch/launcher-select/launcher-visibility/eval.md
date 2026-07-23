---
scenarios:
  - name: dashboard headless launcher visibility
    description: |
      Run the real backend and dashboard for a project configured with at least one interactive launcher and
      one launcher whose registered harness declares headless=true. In a real desktop browser, open the New
      Session launcher picker with dashboard.showHeadlessLaunchers absent or false and capture the settled
      picker, then set the committed field to true, reload settings, reopen the picker, and capture it again.
    expected: |
      The default/false picker shows every configured interactive launcher and no headless launcher. With the
      field true, the same picker also shows the configured headless launcher. Both states remain usable and
      show the real launcher names and commands.
    tags: [frontend-e2e, desktop]
    code: spec-cli/src/harness.ts
    related:
      - spec-cli/src/index.ts
      - spec-cli/src/layout.ts
      - spec-dashboard/src/SessionInterface.jsx
---

# launcher-visibility eval

Measure through the running dashboard's New Session picker. Use screenshots of the two settled static states;
do not infer visibility from the config, adapter registry, or `/api/settings` payload alone.
