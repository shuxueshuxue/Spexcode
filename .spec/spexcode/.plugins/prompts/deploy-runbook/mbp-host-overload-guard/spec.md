---
title: MBP host overload guard
status: active
hue: 32
desc: The Zhipu MBP protects remote-connectivity capacity with measured, reversible, exact-identity host actions.
---

# MBP host overload guard

The Zhipu MacBook Pro's overload protection is operator infrastructure, not SpexCode
product behavior. Its versioned source and incident evidence live in the private fleet
operator repository; the installed form is a root LaunchDaemon on that host.

The guard treats load average as supporting evidence, never as a sufficient trigger.
CPU mitigation requires both high actual CPU consumption and high load normalized by
logical CPU count for a configured duration. Native macOS memory-pressure warning or
critical state is independently sufficient because the measured incident was dominated
by one 14.44 GB SpexCode backend child on a 16 GB host, not by all-core CPU saturation.

On sustained overload, the host emits a local visible alert, temporarily prioritizes
exactly identified SSH, Tailscale, UU Remote, and local-proxy dependencies, and lowers
priority only for non-critical processes whose UID, full executable identity, and exact
argv token are allowlisted. Pause is a later, explicit opt-in escalation. Recovery sends
resume where needed and restores every recorded original priority; shutdown, daemon
restart, and uninstall also attempt restoration. PID start time and exact identity guard
recovery against reuse. The status becomes `paused` only after at least one exact
candidate is successfully stopped and its reversible state is persisted; an escalation
that pauses nothing remains `mitigating`.

The action, actual pause, and stable-recovery transitions each broadcast one fixed,
process-agnostic status line through macOS `wall` to interactive TTYs that are already
logged in. The guard never includes a PID, executable path, or argv token in terminal
messages, never polls or repeats a transition message, and treats missing `who`/`wall`,
TTY enumeration failure, no logged-in TTY, or broadcast failure as a logged notification
failure rather than a daemon-loop failure. Native `wall` is ephemeral: a real macOS SSH
probe proved delivery to an existing SSH TTY and no replay on a later login. The guard
therefore makes no claim for sessions established after a transition and does not alter
`sshd_config`, `/etc/motd`, or shell startup files to manufacture one.

Defaults are conservative: 15-second samples; CPU busy at least 90% together with load
per CPU at least 1.25, or macOS memory pressure at warning or worse; 60 seconds sustained
before priority action; 180 seconds before pause escalation; 120 seconds stable recovery;
and a 600-second cooldown. The generic profile disables pause. The current MBP profile
enables it only for the measured SpexCode backend child, never for a fuzzy `node` name.

The current measurement shows SSH's launchd socket, the Tailscale system extension, and
UU Remote services survive high reported load. They are terminated by an operator- or
system-initiated shutdown, not observed to crash independently. Installation therefore
requires administrator authorization: a per-user agent cannot honestly prioritize
root-owned connection services.

An in-place LaunchDaemon upgrade stages the reviewed bytes before unloading the existing
job, then tolerates launchd's measured asynchronous teardown window with at most six
bootstrap attempts spaced five seconds apart. Every failed attempt records its number,
exit code, and launchctl output. Only exit code 5 is retryable; any other error and a
sixth code-5 failure are returned to the operator unchanged. Repeated installation must
converge on the same single running LaunchDaemon, with a stable run count and identical
staged and installed hashes.
