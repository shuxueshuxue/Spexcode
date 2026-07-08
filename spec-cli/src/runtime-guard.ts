import { spawnSync } from 'node:child_process'

// @@@ session-runtime guard ([[platform-support]]) - SpexCode's session orchestration rests on POSIX
// primitives with no native-Windows analog: tmux (the durable detached PTY + capture-pane scrollback +
// multi-client reattach fabric), hand-written bash launch scripts, and filesystem-path AF_UNIX control
// sockets. The supported runtime is POSIX — Linux, macOS, or Windows *via WSL2* (a real Linux kernel where
// tmux/bash/unix-sockets all work). This is the honest gate at the entry to the session runtime: detect the
// load-bearing primitive (tmux) missing and print ONE actionable line naming the fix, instead of letting a
// cryptic downstream ENOENT be the user's first signal. Read-only CLI (init/lint/board) never calls this,
// so it still runs anywhere the launcher does — only the session-launch path (`spex serve`) is gated.

// tmux presence is the primitive we actually depend on, so probe THAT rather than assuming by platform:
// this also catches a bare POSIX box that simply hasn't installed tmux, not only native Windows.
export function hasTmux(): boolean {
  try {
    return spawnSync('tmux', ['-V'], { stdio: 'ignore' }).status === 0
  } catch {
    return false
  }
}

// Pure so it is unit-testable without spawning or exiting: null = runtime OK; otherwise the stderr lines.
// The pointer branches on platform because the honest repair differs — WSL2 on Windows (no POSIX analog at
// all), install-tmux on a POSIX host that merely lacks it.
export function sessionRuntimeBlock(env: { hasTmux: boolean; platform: string }): string[] | null {
  if (env.hasTmux) return null
  const lines = ['spex: the session runtime needs a POSIX host (tmux, bash, and unix-domain sockets).']
  if (env.platform === 'win32') {
    lines.push('Native Windows has no analog for these — run SpexCode under WSL2 (a real Linux kernel):')
    lines.push('  wsl --install   # then, in the Ubuntu shell: nvm install 22 && npm i -g spexcode')
  } else {
    lines.push('tmux is not on PATH — install it and retry (e.g. `apt install tmux`, `brew install tmux`).')
  }
  return lines
}

// Called at the top of the session-launching command path (`spex serve`). Exits 69 (EX_UNAVAILABLE: a
// required support program does not exist) — a distinct, honest code, not a swallowed error or a stacktrace.
export function assertSessionRuntime(): void {
  const block = sessionRuntimeBlock({ hasTmux: hasTmux(), platform: process.platform })
  if (!block) return
  for (const line of block) console.error(line)
  process.exit(69)
}
