---
scenarios:
  - name: live-terminal-renames-own-session
    tags: [frontend-e2e, desktop, cli]
    description: >
      Through the running dashboard in a real browser, open a live disposable session and type `/rename`
      in its terminal inbox. Confirm the slash menu shows exactly one `/rename` row tagged `[preset]`, pick
      it, and submit. Observe the real input request and then the session row until the driven agent has
      renamed its own SpexCode session. Record the full interaction as video.
    expected: |
      The menu contains one `[preset] /rename` row even if the active harness has a same-named command.
      Picking it only inserts the raw `/rename` invocation; Enter sends that raw text through the ordinary
      `/api/sessions/:id/input` route. The backend expands the live plugin body and the agent executes
      `spex session rename . "<name>"`; `.` resolves to that exact caller session and its board row updates to
      a short work-specific name. No dashboard-only rename action or additional transport is involved.
    test:
      path: spec-dashboard/test/session-command-preset.e2e.mjs
      name: live terminal preset renames the driven session
---

# rename — yatsu

Measure the complete user loop through the dashboard terminal and a real launched agent. API inspection and
unit tests may support diagnosis, but passing requires the visible slash row, ordinary input submission, and
the resulting board rename to occur in one recorded browser run.
