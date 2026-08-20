---
scenarios:
  - name: materialized-listener-completes-the-backend-free-loop
    tags: [cli]
    description: >-
      In a temporary adopter project, materialize the real plugin manifest and invoke the real dispatch.sh path
      for SessionStart and UserPromptSubmit. Resolve the installed spex-session through PATH and through an explicit
      SPEX_SESSION_CLI override, initialize the native payload session, enqueue one message with the real CLI (including
      a header value that contains a fake escaped `bodyBase64` field), and
      capture the handler stdout and database pending state. Repeat SessionStart, then fire an empty prompt event.
      Also run the listener with no database configuration, with database configuration but no resolvable CLI, and
      inspect the script source for forbidden governed/store dependencies.
    expected: >-
      SessionStart creates one protocol address and the repeat is idempotent. One UserPromptSubmit emits valid
      hookSpecificOutput.additionalContext containing the decoded message body and the message is no longer pending;
      a second prompt emits no stdout and exits zero. No configured database yields byte-empty stdout and stderr with
      exit zero. A configured database and missing CLI exits nonzero with one stderr repair line naming installation
      and SPEX_SESSION_CLI. The script contains no session.json, governed, hp_store_dir, hp_runtime_dir, or spex
      internal dependency, and no process remains resident between events.
  - name: listener-preflights-delivery-and-refuses-opaque-corruption
    tags: [cli]
    description: >-
      Run the real handler with an explicit CLI and a PATH that lacks awk, then inspect the protocol queue. Separately
      enqueue raw bytes containing NUL and trailing newlines through the protocol and fire the real dispatcher; also
      enqueue UTF-8 text containing quotes, backslashes, tabs, a trailing newline, and a header value with a fake
      bodyBase64 JSON fragment. Put a PATH shim named `head` that rejects GNU negative byte counts in front of the
      real tools and fire the same dispatcher path.
    expected: >-
      Missing delivery tooling fails before dequeue (exit 2 with a PATH repair entrypoint) and the message remains
      pending. The opaque control-byte body is never rendered as an empty context: the hook exits nonzero and stderr
      names messageId and the original bodyBase64 so the bytes can be recovered. Clean text reaches additionalContext
      byte-for-byte, including its trailing newline, and the fake header field cannot displace the real bodyBase64.
      The rejecting `head` shim is never needed: the event still succeeds with the original body, so no non-POSIX
      capability is hidden behind an existence-only preflight.
  - name: decoder-capability-is-proven-before-consumption
    tags: [cli]
    description: >-
      Put a base64 shim first on PATH that rejects the old `--decode` spelling and accepts `-d` with exit zero but
      copies its input unchanged. Against the old listener, retain the fail-first assertion showing dequeue committed
      before decode failed. Against the repaired listener, run the same pending message and shim through the hook.
    expected: >-
      The fail-first half is discriminating: old code exits nonzero with empty stdout and pending=0. Repaired code
      probes `QQ==` before dequeue, compares the actual bytes rather than trusting exit zero, exits 2 with a compatible
      tooling/PATH repair entrypoint, emits no stdout, and leaves the message pending. The production invocation uses
      `base64 -d`, the spelling measured to decode the fixed byte correctly on Linux and both fleet Macs.
  - name: listener-resolves-only-the-adopter-cli-seam
    tags: [cli]
    description: >-
      Run the listener against a temporary executable shim selected first by SPEX_SESSION_CLI and then by PATH,
      recording argv and returning the frozen dequeue null response.
    expected: >-
      The explicit executable wins over PATH; when it is absent, command -v spex-session is the only resolver. No
      Node package import or guessed node_modules path is used by the hook.
code: .spec/spexcode/.plugins/core/session-listen/session-listen.sh
related: .spec/spexcode/session-runtime/self-launch-cutover/spec.md
---
# session-listen loss

The primary scenario is measured through materialization plus the real dispatcher, not by sourcing the handler as a
unit. The CLI seam scenario is auxiliary evidence for the runtime resolver and deliberately uses one-shot processes.
