---
title: file-attach
status: active
session: 7e2b8db3-d7d4-484e-bfd8-75ae61ffad71
hue: 170
desc: Drop a file on the prompt — a resumable stream carries it to the worker's /tmp and the prompt keeps its path.
code:
  - spec-cli/src/uploads.ts#createUpload
  - spec-cli/src/uploads.ts#appendUpload
  - spec-cli/src/uploads.ts#completeUpload
  - spec-cli/src/uploads.ts#safeName
related:
  - spec-cli/src/uploads.api.test.ts
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/styles.css
  - spec-cli/src/index.ts
  - spec-cli/src/layout.ts
  - spec-cli/src/guide.ts
  - spec-cli/templates/spexcode.json
---
# file-attach

The agent and the dashboard rarely live on the same machine, so an image in your clipboard is bytes the
agent can't see. This node closes that gap: **a file attached to the prompt is carried to the machine the
session runs on, and the prompt is left holding its path.** An attachment becomes an ordinary local path the
agent can just read — no bytes smuggled through the prompt, no out-of-band copy step the human has to narrate.

## attach three ways, both authored surfaces

The same gesture set works on **both** authored composers — the New Session prompt and a running session's
[[command-box]]:

- **Paste** a file (a screenshot, a copied file). A paste that carries files attaches them; a plain text
  paste is untouched and types as before.
- **Drop** a file onto the box. The surface rings to signal it's droppable while a file hovers.
- **Pick** a file from the small attach affordance beside the box.

An offline session has no Command Box and takes none of these — there is no live machine to carry a file to
until it relaunches.

## the path is the whole handoff

Each attached file is uploaded to **the backend**, which is by construction **the machine every session and
worker runs on** — its temp dir is the same `/tmp` home the rendezvous sockets already use, so an upload
shares the worker's filesystem for free. The completed file lands in one `spexcode-uploads/` sink there
under a collision-proof, path-safe name, and its **absolute path** is what gets spliced into the prompt at
the caret, padded so it never glues to a neighbouring word. The human types around it; the agent reads it.
That is the entire contract — "send the file over, hand me the path" — with no transport leaking into the
prompt text.

## one resumable stream

Every attachment — screenshot or multi-gigabyte artifact alike — takes **one offset protocol**, never a
small-file multipart path plus a large-file exception. `POST /api/uploads` creates a transfer from its
sanitised name and exact byte length, returning an opaque id, offset zero, and the resolved request policy:
chunk size, dashboard-batch concurrency, request timeout, and transient-chunk retry parameters. The client
sends raw bytes in ordered `PATCH /api/uploads/:id` requests carrying the expected offset; `GET` returns the
server's committed offset and current policy, so a lost response or interrupted request resumes at the byte
the backend actually has. An offset that is not the committed offset is refused with that offset, never
appended speculatively. `DELETE` discards an unfinished transfer. Only `POST .../complete`, after the
committed byte count equals the declared length, atomically promotes the staging file and returns `{path}`.
An agent therefore never receives a path to a partial file.

The server streams each request directly to one staging file: memory is bounded by one chunk, rather than
the attachment size. Incomplete transfer metadata and `.part` bytes stay under the upload sink's private
staging directory, survive a backend hot replacement, and expire under the resolved transfer policy. That
one policy is `uploads` in the existing `spexcode.json` / `spexcode.local.json` merge: the shipped template
is its sole default source (including the default 2 GiB single-file ceiling), and it names every operational
number — cap, chunk, concurrency, timeout, retry limit/delay, TTL/reaper, free-space reserve, and the older
eval-evidence ceiling. The backend reads it for creation, streaming, status, and cleanup; the dashboard
uses the returned client fields. A cap, capacity, malformed offset, missing transfer, or failed write is a
named refusal; there is no silent downgrade to a buffered upload or a partially-visible file.

## fail loud, never silently drop

An upload is the one moment a file can vanish, so it is **fail-loud on both ends**. The server refuses an
empty file, a stray oversized file, an impossible disk reservation, and a malformed or out-of-order chunk
rather than quietly filling the disk; a write that fails answers with its reason, never a false success. The
client mirrors that through a policy-bounded attachment queue: each file shows its name, bytes sent, progress,
and a concrete failure reason, with configured transient-request retries plus retry and cancel controls. A
completed row splices only its returned path into its original composer; a failed or cancelled row never
changes the draft. The paperclip shows queue activity without collapsing all file state into one generic
spinner. A crafted filename can't escape the upload dir — the name is reduced to a bare, sanitised basename
first.

## where it lives

The gestures, the path-splicing, and the attach affordance are the authored composers in `SessionInterface.jsx`
([[session-console]], [[command-box]]); their styling rides `styles.css`. The upload endpoint and the
`/tmp` sink are the backend's ([[api-endpoint]], [[sessions]]) — a thin route over a small upload module,
the same shape [[session-rename]] uses to span the UI and the server for one feature. This node's slices of
those shared files are just the attach-control styling in `styles.css` and the `/api/uploads` route in
`index.ts`; the eval tab's `.eval-*` classes and its eval-blob endpoint, reworked when the eval engine was
reframed to serve a verdict over transcript-or-image evidence, are [[spec-eval]]'s churn, not file-attach's
drift.
