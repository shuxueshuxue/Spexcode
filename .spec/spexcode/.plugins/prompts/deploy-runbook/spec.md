---
title: Fleet deployment runbook
status: active
desc: The complete operator runbook for deploying SpexCode to its four dogfood targets — two supply chains, iron ordering, verification loop.
surface: system
---

# Deploying the fleet (operator runbook)

Four deployments, two supply chains. (Correction to folk memory: gugu/z-code do NOT pull from the npm
registry — both install a locally-built tarball via `npm i -g`; z-code's mbp cannot even reach GitHub.)

## Supply chain A — shared source checkout (ThinkPad): spexcode itself + rocket delta

Both run `/home/jeffry/spexcode` directly (tsx, no build step for the backend).

- **spexcode**: tmux `spex-backend` (supervisor on :8787) + `spex-gateway` (TLS :9443 → public
  https://bj01.ezfrp.com:20703, password in `spexcode-ops/.env`). Launch/repair via
  `bash ~/spexcode-ops/deploy/spex-ensure.sh` (port-guarded, idempotent — ALWAYS prefer it over
  hand-crafted tmux commands; a bare C-c into the pane kills the tmux session entirely).
- **rocket delta**: tmux `rocket-backend` (:8788) + `rocket-web` (:5174), default tmux socket,
  cwd `/home/jeffry/rocket-delta-workspace`, same source checkout.
- A merge to main hot-reloads the backend **child** only. Changes to `supervise.ts`, the gateway,
  the reaper, or spawned-env need a **full restart**: kill both tmux sessions, re-run `spex-ensure.sh`.
- Frontend changes reach the gateway ONLY via a dist rebuild: `cd spec-dashboard && npm run build`,
  then restart the gateway.
- rocket per release: follow any migration procedure named by that release, then in the workspace run
  `spex materialize` → refresh git hooks → restart its tmux pair.

## Supply chain B — local tarball to npm-global (Macs): gugu (macmini) + z-code (mbp)

1. **Build** (any current checkout): `npm pack` → `spexcode-<ver>.tgz` (prepack builds dashboard dist).
2. **Ship**: `scp -F ~/YellowPage/ssh_config <tgz> macmini-tail:~/` and `mbp-tail:~/`.
3. **z-code checkout too** (mbp keeps a source checkout at `~/spexcode`, GitHub-blocked):
   `git bundle create <b> main ^<their-head>` → scp → on mbp `git fetch <b> main && git merge --ff-only FETCH_HEAD`.
4. **Install**: macmini needs `source ~/.nvm/nvm.sh && nvm use 22` first; then `npm i -g ~/spexcode-<ver>.tgz`.
5. **Drain check**: `spex session ls` in the adopter repo — active sessions are merged-then-closed first.
6. **Release migration** (only when that release ships one): follow that release's exact procedure,
   review every staged byte and warning, commit it, then clear any lint errors the new rules surface
   (real fixes, not bypasses) and push. There is no permanent generic migration verb.
7. **Hooks per clone**: `cp $(npm root -g)/spexcode/spec-cli/templates/hooks/* $(git rev-parse --git-path hooks)/ && chmod +x` —
   adopter repos have no `npm run hooks`.
8. `spex materialize`.
9. **Full restart**: `tmux -L spexcode kill-session -t <name>-backend/-web` + `bash ~/spex-boot.sh`.
   Launch scripts must say `spex serve ui` (the 0.3.0 spelling; `spex dashboard` signposts and dies).
10. **Verify**: `/health` ok · `/api/plugins` 200 · `/api/graph` 200 · web 200.

## Iron ordering + verification

drain → toolchain → release migration (when present) → hooks → materialize → **full restart** → verify. Never reorder.
The acceptance for the ThinkPad deploy is the gateway full loop: headless browser through the public
URL — login → graph renders → create a session from the UI → the worker actually runs and declares.
File it as an eval reading (`public-mode` / `gateway-full-loop`). Restarting the backend mid-fleet
briefly mislabels live sessions `error` (issue filed) — verify liveness via tmux/pane before believing it.
