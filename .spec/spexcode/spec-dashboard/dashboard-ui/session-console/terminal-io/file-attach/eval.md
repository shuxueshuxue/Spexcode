---
scenarios:
  - name: pick-splices-backend-tmp-path
    tags: [frontend-e2e, backend-api]
    test: spec-dashboard/test/command-box.e2e.mjs
    description: >
      Through the running dashboard in a real browser, open the New Session prompt (`.si-input`) and type a
      few words so there is a caret position mid-text. Attach a file through one of the real gestures — PASTE
      a file, DROP it on the box, or the paperclip affordance (`.si-attach`, the shared hidden
      `<input type=file>` the button triggers) — choosing a small real file
      with a crafted-ish name (e.g. `shot 1.png`). Watch the attach glyph: while the bytes are in flight it
      shows the spinning busy ring (`.si-attach-busy`), then returns to the paperclip. After it settles, read
      the textarea's value and confirm an ABSOLUTE path was spliced in at the caret, space-padded so it never
      glues to a neighbouring word. Then corroborate the whole handoff on the backend: the file actually
      landed under the upload sink and the spliced string is exactly its path. (The same gesture set works on
      a live session's Command Box; an offline session exposes no Command Box.)
    expected: |
      The picked file is uploaded through the resumable backend stream (`POST /api/uploads` → create,
      ordered `PATCH` chunks → `POST /api/uploads/:id/complete` → `201 {path}`) and lands in one
      `spexcode-uploads/` sink under the backend's tmpdir, under a collision-proof, path-safe basename (the
      crafted name reduced to `[A-Za-z0-9._-]`, no directory parts, no leading dots). The returned ABSOLUTE
      path is spliced into the prompt at the caret, padded with spaces so it never abuts neighbouring words;
      the human's surrounding text is preserved. While uploading, the attach control shows its busy ring, not
      the paperclip; on success it returns to the paperclip and no error surfaces. The file read back from the
      spliced path on the backend equals the bytes that were attached — the path is the whole handoff, with no
      transport text leaking into the prompt.
  - name: empty-upload-refused-fail-loud
    tags: [frontend-e2e, backend-api]
    description: >
      Through the running dashboard in a real browser, open the New Session prompt and attach an EMPTY file
      (zero bytes) through the paperclip picker. Watch the attachment row and the prompt box. Separately,
      exercise the backend contract directly: create a zero-byte or malformed transfer and read the HTTP
      status + JSON. Confirm nothing is spliced into the prompt and no empty file is written into the upload
      sink.
    expected: |
      The upload is refused LOUD, never silently swallowed: creation answers `400` for a zero-byte or
      malformed file and `413` for one over the resolved `uploads.maxBytes` ceiling; a capacity refusal
      names the disk constraint.
      The client mirrors that in the file's visible row, with its concrete error and a retry/cancel control,
      and NO path is spliced into the prompt (the box keeps exactly its prior text). No zero-byte file
      appears in the `spexcode-uploads/` sink.
  - name: interrupted-large-upload-resumes-atomically
    tags: [frontend-e2e, backend-api]
    test: spec-cli/src/uploads.api.test.ts
    description: >
      Through a real backend and the dashboard's New Session composer, attach a real file larger than the
      former request cap. Let at least one configured `uploads.chunkBytes` chunk commit, interrupt one chunk
      before its response, then retry from the attachment row. Read the server status between attempts and
      finally inspect the returned path and bytes on the backend.
    expected: |
      Every request is at most the resolved chunk policy; the backend reports the actual committed offset
      after interruption and retry sends only the remaining suffix. The row's byte count/progress resumes
      rather than restarting, then completes and splices one absolute final path. The completed file's bytes
      and declared length match exactly; no partial path ever enters the draft. A cancelled transfer removes
      its staging state and leaves the draft unchanged.
---

# file-attach — eval

Measure through the **real dashboard surface**, YATU-style, plus the backend it hands off to. file-attach's
whole contract is *"send the file over, hand me the path"*: a file attached to either authored composer
(New Session or a live Command Box) is carried to the machine the session runs on — the backend — and the draft is left
holding its **absolute path**, an ordinary local file the agent can just read. So the loss has three ends and
all are scored: the **per-file transfer row** in the browser (name, bytes, progress, retry/cancel and no
premature splice), the **resumable stream** (policy-bounded requests, a committed offset that survives an
interrupted request), and the **backend landing** (only a completed file promoted under the one upload sink,
with a sanitised basename and intact bytes). The refusal edge scores empty, oversized, capacity, malformed,
or cancelled transfers: each has a status + reason on the server and a concrete visible client row, never a
silent drop. Evidence: browser progression and final path splice, plus an API transcript showing resume
offsets and the final backend bytes.
