---
scenarios:
  - name: serve-on-non-posix-points-at-wsl2
    description: >
      Run the real `spex serve` bin — the entry to the session runtime — on a host that lacks the
      load-bearing primitive (tmux), and read its actual stderr + exit code. Native Windows has no POSIX
      analog for tmux/bash/AF_UNIX, so a Linux/macOS box measures the same gate by hiding tmux from PATH
      (`PATH=<dir-with-only-node> node spec-cli/bin/spex.mjs serve`).
    expected: >
      ONE actionable line — "the session runtime needs a POSIX host" plus the honest fix pointer (WSL2 on
      Windows, install-tmux on a bare POSIX host) — and a clean exit 69 (EX_UNAVAILABLE). Never a cryptic
      downstream `spawn … tsx ENOENT` or an esbuild stacktrace.
    tags: [cli, backend-api]
    code: spec-cli/src/runtime-guard.ts
---

# measuring platform-support

YATU: invoke the shipped `spex serve` bin exactly as a user would, on a host missing the session-runtime
primitive, and read the *real* stderr and exit code — never a reasoned claim about the source. On Linux/macOS
the non-POSIX condition is simulated honestly by removing tmux from `PATH` (the guard keys on the missing
primitive, not on the OS name, so a tmux-less POSIX host exercises the same gate a native-Windows host would).
Zero loss = one legible line pointing at the fix and exit 69; loss = any cryptic downstream crash.
