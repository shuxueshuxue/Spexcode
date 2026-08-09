---
scenarios:
  - name: agent-publishes-a-live-path-through-cli
    tags: [cli, backend-api]
    test: spec-cli/src/session-files.api.test.ts
    description: >-
      In an isolated initialized project, create a real session with the public CLI, write an artifact outside
      its worktree, then run the public `spex session files add`, `ls`, and `retract` commands from that
      session's worktree. Inspect the dedicated session `files.json` and the artifact before and after each
      operation.
    expected: >-
      `add` records one absolute path in the session-owned list without changing the artifact's bytes or
      location; `ls` reports that path; and `retract` removes only that entry. A relative input resolves from
      the posting CLI's cwd. No artifact copy, upload, staging file, or worktree-local session state appears.
  - name: dashboard-shows-live-files-and-downloads-current-bytes
    tags: [frontend-e2e, backend-api]
    test: spec-dashboard/test/session-files.e2e.mjs
    description: >-
      Open a real served dashboard in a browser on a selected session with no posted files and capture the
      disabled grey files control. Publish a real artifact with the public CLI, change its bytes in place,
      refresh the dashboard state, capture the live control and open its list, then click the filename to inspect
      the path in its resource tab and use the adjacent download tool to read the browser download.
    expected: >-
      The empty session control is visibly disabled; after publication it is active and lists only the file
      name. The full absolute path appears only on its copy-path icon's tooltip. The compact menu fits the
      longest visible name plus its two fixed icon tools; those two action columns share one right edge across
      every row rather than following each filename. Opening the
      menu transfers no file bytes. Clicking the filename opens or selects that path's singleton resource
      tab with the current escaped text or raster image without a disk download; no pop-out preview exists.
      That selected tab's right-side toolbar offers refresh, download, and copy path; its download tool downloads
      the bytes currently at that path, including the post-publication edit,
      proving that the list is a live reference rather than a snapshot. Clicking outside the transient dropdown
      dismisses it.
  - name: preview-refuses-untrusted-or-oversized-files-loudly
    tags: [frontend-e2e, backend-api]
    test: spec-dashboard/test/session-files.e2e.mjs
    description: >-
      Publish an SVG, archive, or other unsupported file and a text file larger than 2 MiB. Through the real
      dashboard resource tab and backend route, attempt each preview without using download.
    expected: >-
      Unsupported extensions receive a named 415 directing the human to download, and files over 2 MiB receive
      a named 413 stating the preview ceiling and actual size. No unsupported markup enters the dashboard DOM,
      and neither response silently truncates or downloads the file.
  - name: markdown-previews-select-and-start-at-the-top
    tags: [frontend-e2e, backend-api]
    test: spec-dashboard/test/session-web.e2e.mjs
    description: >-
      Publish a real `.md` file through the CLI, then open it from the files menu in Chromium. Inspect its first
      heading, raw-markup treatment, scroll origin, and browser text selection in the resulting resource tab.
    expected: >-
      The single resource-tab surface renders restricted Markdown, not a raw preformatted source dump; raw HTML
      remains inert text. The first rendered content is visible at scroll position zero, and the human can select
      and copy document text without the hidden terminal consuming the gesture.
  - name: html-previews-rendered-in-a-script-free-frame
    tags: [frontend-e2e, backend-api]
    test: spec-dashboard/test/session-files.e2e.mjs
    description: >-
      Publish a real `.html` file through the CLI, open it from the selected session's files menu, and inspect
      the resulting resource tab in Chromium.
    expected: >-
      The file renders as HTML inside the resource tab instead of a raw source `<pre>`. The preview is a sandboxed
      iframe without script execution or dashboard DOM access, while the adjacent download action remains available.
  - name: download-is-authorized-and-missing-paths-fail-loud
    tags: [backend-api]
    test: spec-cli/src/session-files.api.test.ts
    description: >-
      Against the real backend, request downloads for readable and nonexistent paths not posted by the selected
      session, then publish a path and delete its target before requesting it through the same route.
    expected: >-
      Every unposted path is refused with a named 403 before filesystem lookup and moves no bytes, so the
      route cannot reveal whether an arbitrary host path exists. A posted target that no longer resolves
      remains listed but its download returns a named 404; neither condition is represented as an empty or
      successful file download.
---

# files - eval

Measure the feature through the real CLI, backend, and browser surfaces. The proof has to distinguish a
stored live path from an upload: observe the target remain in place after `add`, change its bytes before the
browser click, and inspect the downloaded result. The two browser screenshots show the required empty and
live states; the HTTP cases prove that the posted list, not ambient filesystem access, authorizes download.
