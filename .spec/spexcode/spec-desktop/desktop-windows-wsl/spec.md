---
title: desktop-windows-wsl
status: pending
hue: 30
desc: Windows runs the gateway inside WSL2 — detection, an honest first-run page, an idempotent bootstrap, spawn-through-wsl, and WSL-side project paths.
related:
  - spec-desktop/main.js
  - spec-desktop/wsl.js
  - spec-desktop/wsl-bootstrap.sh
  - spec-desktop/first-run.html
  - spec-desktop/first-run-preload.js
  - spec-desktop/wsl-entry.cjs
  - spec-desktop/node-entry.mjs
  - spec-cli/src/runtime-guard.ts
  - spec-cli/src/doctor.ts
code:
  - spec-desktop/wsl.js
---
# desktop-windows-wsl

The session runtime needs a POSIX host — tmux, bash and unix-domain sockets, exactly what `runtime-guard.ts`
probes — and native Windows has none of them. WSL2 provides all three, so on Windows the shell runs the gateway
**inside the user's default WSL2 distro** and opens the forwarded loopback port. Windows users get the full
product, TUI sessions included; the shell adds nothing the Linux build lacks. This routes around the tmux
assumption rather than fixing it; the fix is [[session-host]], and this node does not wait for it.

**Detect, then either bootstrap or stop.** `wsl.exe -l -v` decides: no WSL, or a version-1 distro, and the shell
shows the first-run page naming the exact user action — `wsl --install` in an administrator PowerShell, reboot,
reopen — and does nothing else. It never falls back to a half-working native mode.

**The first-run page is the one shell-owned surface, and it shows the transcript.** Until the gateway exists
there is no dashboard to load, so the shell ships a static page that streams the bootstrap's real stdout and
stderr step by step — detect, install, doctor — and names each point where the user must act (the sudo password
for `apt`, the agent's interactive login). No progress bar stands in for output. The moment `/health` answers,
the shell navigates to the gateway and the page is not shown again unless the gateway is unreachable.

**Bootstrap is idempotent and runs inside the distro.** `wsl.exe -d <distro> -- bash -lc` installs tmux and git
via apt (the one sudo prompt), Node 22 through nvm honouring the repo's `.nvmrc` pin, and spexcode; it ends by
running the real `spex doctor`, whose output is the last thing the page shows. Re-running it on a healthy distro
changes nothing and says so.

**The gateway is spawned through `wsl.exe`.** The utility child runs
`wsl.exe -d <distro> -- bash -lc 'spex dashboard --port N'`, reads the same ready line as on Linux, and the
window loads `http://localhost:N/` — WSL2 forwards loopback to Windows by default, so the SPA needs nothing.
Attach-before-start reads the WSL-side records the same way.

**Projects live on the Linux side.** A repo under `/mnt/c` goes through 9p, where git and inotify are slow or
broken and the graph's live rebuild would suffer; the folder picker therefore browses `\\wsl$\<distro>\`,
translates the UNC path to `/home/…` before `POST /projects`, and refuses a `/mnt/c` path with that one-line
reason rather than accepting a slow project.

## Implementation boundary

`wsl.js` is the shell's WSL adapter. It decodes the UTF-16 `wsl.exe -l -v` response, selects the starred
version-2 distro, exposes the `SPEXCODE_DESKTOP_WSL_PROBE` test seam, and translates `\\wsl$\\<distro>\\home\\…`
paths to `/home/…`. Native drive paths and `/mnt/*` are refused before the existing project POST with the 9p
reason. `wsl-bootstrap.sh` is fed through `wsl.exe` with a piped stdin, so apt's single sudo prompt remains in
the verbatim transcript; it uses a bundled tarball when supplied and otherwise reports its npm fallback before
running the real `spex doctor`. `first-run.html` is a static `file://` transcript surface; the preload bridge
only carries the sudo response back to the shell. Once `/health` responds, the shell closes that page and loads
the same gateway URL used by a browser.

**Stated constraints.** WSL's VM stops with the Windows session, so sessions stop at logout; records and
worktrees persist on disk and resume after login — the same disk-not-process invariant as the host resource
rules. WSL2 takes up to half of RAM by default: the bootstrap offers a recommended `%UserProfile%\.wslconfig`
memory cap and [[host-facts]] reports whether one is present. Agent CLIs live in WSL, so a user with Claude Code on
Windows logs in once more inside the distro — on Linux the token is a plain file, so no keychain is involved.
