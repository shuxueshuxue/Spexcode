---
scenarios:
  - name: pick-splices-backend-tmp-path
    tags: [frontend-e2e, backend-api]
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
      a live session's `❯` inbox; the offline `❯` box takes none of it.)
    expected: |
      The picked file is uploaded to the backend (`POST /api/uploads` → `201 {path}`) and lands in one
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
      (zero bytes) through the paperclip picker. Watch the attach control and the prompt box. Separately,
      exercise the backend contract directly: `POST /api/uploads` with an empty file part, and with no file
      part at all, and read the HTTP status + JSON. Confirm nothing is spliced into the prompt and no empty
      file is written into the upload sink.
    expected: |
      The upload is refused LOUD, never silently swallowed: the server answers `400 {error:"no file"}` for a
      zero-byte or missing file (and `413` for one over the ~50MB ceiling) rather than writing it, so a stray
      file can't quietly fill the disk. The client mirrors that — the attach surface raises its visible error
      (`.si-attach-err`) instead of eating the file, and NO path is spliced into the prompt (the box keeps
      exactly its prior text). No zero-byte file appears in the `spexcode-uploads/` sink.
---

# file-attach — eval

Measure through the **real dashboard surface**, YATU-style, plus the backend it hands off to. file-attach's
whole contract is *"send the file over, hand me the path"*: a file attached to either prompt box (New Session
or a live `❯` inbox) is carried to the machine the session runs on — the backend — and the prompt is left
holding its **absolute path**, an ordinary local file the agent can just read. So the loss has two ends and
both are scored: the **path splice** in the browser (an absolute `spexcode-uploads/` path padded into the
textarea at the caret, the busy ring while in flight) and the **backend landing** (the file present under the
one upload sink with a sanitised basename, its bytes intact). The second scenario scores the **fail-loud**
edge — an empty/oversized/missing upload is refused with a status + reason on the server and a visible error
on the client, never a silent drop. Evidence: the browser reading of the spliced path + the attach control's
state, and a backend transcript that the file (or, for the refusal, no file) is where the contract says.
