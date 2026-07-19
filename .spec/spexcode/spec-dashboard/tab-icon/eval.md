---
scenarios:
  - name: scoped-and-gateway-favicons
    tags: [frontend-e2e, desktop]
    description: >-
      Run an isolated host gateway with two registered project backends whose `dashboard.icon` values are
      distinct, plus a distinct host `gateway.icon`. In a real browser load `/projects`, then each
      `/p/<id>/` route, and read the settled `link[rel~="icon"].href`. Repeat one project with a legacy
      emoji and arbitrary Iconify value to prove compatibility.
    expected: >-
      `/projects` uses the gateway preset's data SVG; each scoped URL uses only that catalog row's icon and
      never the last board/catalog row loaded. Preset marks are serialized from [[icon-presets]], emoji
      remains an inline text SVG, and an arbitrary Iconify value remains its Iconify URL. `index.html`
      contains only the link mount, never a second drawing.
    code: spec-dashboard/index.html
    related:
      - spec-dashboard/src/App.jsx
      - spec-dashboard/src/IdentityIcon.jsx
      - spec-cli/src/identity-presets.js
---
# tab-icon loss

YATU through the real gateway page: read the document's actual favicon link after each route settles and
capture the rendered tabs/states. Helper output is auxiliary; the browser's route-specific link is truth.
