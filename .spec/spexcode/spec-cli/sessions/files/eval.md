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
      refresh the dashboard state, capture the live control and open its list, then click the path to inspect
      its preview and use the adjacent download tool to read the browser download.
    expected: >-
      The empty session control is visibly disabled; after publication it is active and lists the absolute
      file name, whose full absolute path is available in its hover tooltip. Opening the menu transfers no
      file bytes. Clicking the eye button opens a separate pop-out with the current escaped text or raster
      image without a disk download; its adjacent download tool downloads the bytes currently at that path,
      including the post-publication edit, proving that the list is a live reference rather than a snapshot.
      Clicking outside either transient surface dismisses it.
  - name: preview-refuses-untrusted-or-oversized-files-loudly
    tags: [frontend-e2e, backend-api]
    test: spec-dashboard/test/session-files.e2e.mjs
    description: >-
      Publish an SVG, archive, or other unsupported file and a text file larger than 2 MiB. Through the real
      dashboard pop-out and backend route, attempt each preview without using download.
    expected: >-
      Unsupported extensions receive a named 415 directing the human to download, and files over 2 MiB receive
      a named 413 stating the preview ceiling and actual size. No unsupported markup enters the dashboard DOM,
      and neither response silently truncates or downloads the file.
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
