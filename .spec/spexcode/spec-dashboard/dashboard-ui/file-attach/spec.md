---
title: file-attach
status: active
session: 7e2b8db3-d7d4-484e-bfd8-75ae61ffad71
hue: 170
desc: Drop a file on the prompt — it rides to the worker's /tmp and the prompt keeps its path.
code:
  - spec-dashboard/src/SessionInterface.jsx
  - spec-dashboard/src/styles.css
  - spec-cli/src/uploads.ts
  - spec-cli/src/index.ts
---
# file-attach

The agent and the dashboard rarely live on the same machine, so an image in your clipboard is bytes the
agent can't see. This node closes that gap: **a file attached to the prompt is carried to the machine the
session runs on, and the prompt is left holding its path.** An attachment becomes an ordinary local path the
agent can just read — no bytes smuggled through the prompt, no out-of-band copy step the human has to narrate.

## attach three ways, both input surfaces

The same gesture set works on **both** prompt boxes — the New Session prompt and a running session's `❯`
inbox:

- **Paste** a file (a screenshot, a copied file). A paste that carries files attaches them; a plain text
  paste is untouched and types as before.
- **Drop** a file onto the box. The surface rings to signal it's droppable while a file hovers.
- **Pick** a file from the small attach affordance beside the box.

The offline `❯` box takes none of these — there is no live machine to carry a file to until it relaunches.

## the path is the whole handoff

Each attached file is uploaded to **the backend**, which is by construction **the machine every session and
worker runs on** — its temp dir is the same `/tmp` home the rendezvous sockets already use, so an upload
shares the worker's filesystem for free. The file is written there under a collision-proof, path-safe name,
and its **absolute path** is what gets spliced into the prompt at the caret, padded so it never glues to a
neighbouring word. The human types around it; the agent reads it. That is the entire contract — "send the
file over, hand me the path" — with no transport leaking into the prompt text.

## fail loud, never silently drop

An upload is the one moment a file can vanish, so it is **fail-loud on both ends**. The server refuses an
empty file, and a stray oversized one, rather than quietly filling the disk; a write that fails answers with
its reason, never a false success. The client mirrors that: while bytes are in flight the attach control
shows it's busy, and an upload that returns no path raises a visible error on that surface instead of
swallowing the file. A crafted filename can't escape the upload dir — the name is reduced to a bare,
sanitised basename first.

## where it lives

The gestures, the path-splicing, and the attach affordance are the prompt boxes in `SessionInterface.jsx`
([[session-console]], [[term-input]]); their styling rides `styles.css`. The upload endpoint and the
`/tmp` sink are the backend's ([[api-endpoint]], [[sessions]]) — a thin route over a small upload module,
the same shape [[session-rename]] uses to span the UI and the server for one feature.
