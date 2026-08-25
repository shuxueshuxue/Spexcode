---
scenarios:
  - name: resource-opens-beside-the-session-and-stays-warm
    tags: [frontend-e2e, desktop]
    code: [spec-dashboard/src/SessionInterface.jsx#SessionResourcePanel]
    description: >
      Post a file and a local web service from a live session, open each from the resource picker, scroll the file
      preview, switch to the session tab and to another session, return, then close the resource tab.
    expected: >
      Each opens as a file-class workspace tab beside the untouched session document; returning shows the same DOM
      instance with its scroll position (no re-read, no iframe reload); the web frame takes focus on selection and
      Escape peels overlays before returning to the session sink; closing returns to the held session tab and its
      warm terminal, and only close, retraction, or session retirement releases the tab.
---
# measuring resource-tabs

Warmth is proven by identity of the mounted instance across selections, not by timing.
