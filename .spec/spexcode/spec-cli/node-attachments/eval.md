---
scenarios:
  - name: a-node-lists-its-own-folder-and-only-its-own
    tags: [backend-api]
    description: >-
      Against a running `spex serve`, request `/api/specs/:id/files` for a node with an evidence directory,
      a node carrying only its eval contract, a node whose folder holds nothing but child node folders, and
      a mid-tree node. Record each list.
    expected: >-
      A node reports the files in its own folder, recursively, and stops where a CHILD node's folder begins —
      a directory holding a `spec.md` is another node and everything under it belongs to that node. So the
      tree root, whose folder holds only child folders and its own body, carries nothing at all, while a node
      with an evidence directory carries every file in it. A parent that listed a child's evidence would make
      one file appear under several nodes, which is the failure this rule exists to prevent.
  - name: refusals-are-loud-and-leak-no-host-path
    tags: [backend-api]
    description: >-
      Request `…/files/content` with a name that escapes the folder, an absolute name, a name with its own
      surface (`spec.md`), an empty name, and a name that does not exist; then request the listing for an
      unknown node id. Record every status and body.
    expected: >-
      Each is refused with a status and a sentence naming why — escape, absolute, own-surface and empty as
      400, a missing file and an unknown node as 404. **No response contains the checkout's absolute path.**
      Node puts the path it tried to open into its exception message and these strings are API responses, so
      only the error code may cross that boundary.
---
# eval.md - node-attachments

The second scenario is here because exercising the refusal paths, not the happy one, is what found both
defects this node shipped with: an error message that carried the host's absolute path into an API response,
and an absolute name being silently reinterpreted as relative. A scenario that only proved a file can be
read would have passed over both.
