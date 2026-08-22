# Eval closure batch nine

Session: `51f57a00`

Requested measurement tree: parent `ee611ecbc508aa0d4c270b4631031e0f5acffcf`.

Setup was verified with absolute Node `v22.21.0` and npm `10.9.4`. The checkout initially had no
`node_modules` or workspace `dist`; `npm ci --ignore-scripts` and the repository build repaired that
runner-only prerequisite. The declared browser driver exists at
`/home/jeffry/studio-harness/node_modules/playwright/index.mjs` with Chromium at `/snap/bin/chromium`.

## Requested scenarios

| scenario | result | precise measurement reason |
| --- | --- | --- |
| `state/session-verb-chain-v030` | NOT-MEASURED | The real Node22 backend and public `spex session new --launcher codex-headless` path were attempted in an isolated home/port. Creation reached the public record and returned a queued/offline worker, but it inherited the caller's non-governed parent and never became a live dispatched worker. The required show/send/raw-key/stop/resume/close chain therefore could not be exercised; the temporary worktree and branch were removed. No product verdict was inferred. |
| `host-resource-budget/leaf-identity-changes-during-stop-guard` | NOT-MEASURED | The isolated real backend answered the public `spex session resources --json` surface with zero session/process owners. A public `spex session stop missing-leaf` refused with exit 2. No exact real child leaf with PID/start identity existed, so the shared-guard identity-change boundary and TERM/KILL signal decision were not exercised. The internal monkeypatch test was not substituted. |
| `session-nesting/whole-row-drag-reparents-and-detaches` | NOT-MEASURED | The declared real Chromium runner was started against a fresh Vite dashboard and isolated backend, but Playwright stopped before creating a browser context because its required ffmpeg binary was absent (`/tmp/.../.cache/ms-playwright/ffmpeg-1011/ffmpeg-linux`). The isolated graph also had zero live parent/child sessions. No hand-forged nested records or fake browser run was used. |
| `evals-view/detail-source-resolution-and-unmeasured-state` | PASS | The real Node22 backend returned HTTP 200 for a removed scope with `scope:null`, `requestedScope:"removed-scope"`, `scopeFallback:"trunk"`, and three-record trunk history. Real Chromium rendered the canonical detail route and its stale/detail state copy. Reading filed at the exact requested tree with structured data evidence. |
| `packaging/omit-optional-l0-adopter` | PASS | A clean root tarball install with `--omit=optional --omit=dev --ignore-scripts` passed the L0 lint/graph/materialize/init/guide matrix. Missing-dashboard `serve ui` and `dashboard` exited 1 before binding with the repair command. A tracked Python adopter using `sourceExtensions:["py"]` passed lint/graph; materialize passed in an isolated clone while the live Git worktree stayed clean. Reading filed at the exact requested tree. |

No product code, scenario prose, specs, acknowledgements, or acceptance artifacts were changed. No full
acceptance was run. All temporary backends, Vite processes, tmux sockets, fixture projects, worker worktree,
and generated setup output are removed before commit.
