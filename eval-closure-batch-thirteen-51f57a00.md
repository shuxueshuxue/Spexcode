# Eval closure batch thirteen

Session: `51f57a00`

## Real launcher selection probe

Measured with absolute Node `v22.21.0` against the current branch-local `spec-cli/dist/cli.js` backend and
CLI. The fixture was a fresh Git project with two inert configured launchers (`alpha` and `beta`, both
`harness: claude`, `cmd: true`) and an isolated `SPEXCODE_HOME`, tmux name, and port. The transcript is
`/tmp/eval-launcher-select-batch13-clean.json`.

The first probe is explicitly discarded: the fixture omitted the required top-level `harnesses` list, so
the created rows carried a materialize setup failure. After adding `harnesses: ["claude"]`, the clean run
produced the following product observations:

- no configured default + no `--launcher`: CLI exit 1, backend HTTP 400 with the actionable
  `sessions.defaultLauncher is required` message, and zero session records;
- configured default `beta` + no `--launcher`: CLI exit 0, record launcher is `beta`;
- configured default `beta` + explicit `--launcher alpha`: CLI exit 0, record launcher is `alpha`;
- unknown `--launcher missing`: CLI exit 1, backend HTTP 400, and no additional record.

The inert command intentionally exits after selection; this batch claims launcher resolution and create
refusal only, not worker liveness or managed-watch establishment.

## Filed readings

`launcher-select/missing-default-launcher-refuses-create` and `launcher-select/qualified-new-launcher`
were filed as PASS at codeSha `76e66fad3`, each with the same structured transcript but a scenario-specific
note. `resume-replays-original-launcher-not-current-default` remains unmeasured because this probe did not
perform the stop/config-change/resume sequence.

A bounded resume probe was attempted separately with inert shell launchers. It created the public records, but
the fixture had no materialized `launch.sh` to inspect, so the stop/resume command path could not establish the
declared pinned-command precondition. That run was setup-only and produced no verdict; its two exact tmux servers
were stopped immediately.

No product code, scenario prose, spec, or acceptance artifact was changed. `git diff --check` and
`spex eval lint --changed` were run before committing; the two readings reduced the stale count from 41 to 39.
