---
scenarios:
  - name: gemini-native-fixture
    tags: [cli]
    test: packages/transcript/src/readers.test.ts
    code: packages/transcript/src/readers.ts
    description: Read the frozen Gemini CLI session JSONL by session id.
    expected: User and assistant prose are returned, the MCP tool call keeps its JSON input, its function response is joined by call id, and private metadata/thoughts are absent.
  - name: hermes-export-fixture
    tags: [cli]
    test: packages/transcript/src/readers.test.ts
    code: packages/transcript/src/readers.ts
    description: Read the frozen Hermes one-document export through a profile state.db revision.
    expected: The export is cached per state.db revision, user and assistant prose plus tool calls/results are normalized, and reasoning fields are never turns.
  - name: openclaw-native-fixture
    tags: [cli]
    test: packages/transcript/src/readers.test.ts
    code: packages/transcript/src/readers.ts
    description: Read the frozen OpenClaw per-agent session JSONL by stable session id.
    expected: User and assistant prose, tool input, and tool output joined by toolCallId are returned while thinking blocks and bootstrap records remain private.
  - name: bounded-claude-codex-interval
    tags: [backend-api]
    test: packages/transcript/src/readers.test.ts
    code: packages/transcript/src/readers.ts
    description: Read real-shaped Claude JSONL and Codex rollout fixtures through the adapter reader with a bounded epoch interval, including a Codex final answer and more turns than the cap.
    expected: Only records inside the requested interval become normalized turns, parallel tool results are all joined without native envelopes, orphan output bytes are reported as omitted, the cap keeps the newest turns and counts the dropped ones, and timestamp disorder reports honest truncation.
  - name: pi-and-opencode-native-shapes
    tags: [backend-api]
    test: packages/transcript/src/readers.test.ts
    code: packages/transcript/src/readers.ts
    description: Read a pi session JSONL located by its header id and an OpenCode export cached by store revision, each with private reasoning, a tool call, and its result.
    expected: Both readers return the same normalized turn shape as Claude and Codex; a running OpenCode tool has no output field; an unchanged store is not exported again while a moved write-ahead log is; reasoning never appears.
  - name: open-interval-reread-seeks
    tags: [backend-api]
    test: packages/transcript/src/readers.test.ts
    code: packages/transcript/src/readers.ts
    description: Read one open interval of a long Claude thread, append the running tool's result, observe the revision move, and read the same interval again.
    expected: The first read shows the call without output; the append changes the revision; the second read joins the output and, because it resumed at the interval's first event, counts nothing older as omitted.
  - name: tool-outcome-is-the-harness-verdict
    tags: [backend-api]
    test: packages/transcript/src/parsers.test.ts
    code: packages/transcript/src/parsers.ts
    description: Read a real Claude thread in which a Bash call ended with is_error, and parse structured failure fields from every harness that writes one (Claude is_error, pi/OpenClaw isError, OpenCode state error, Gemini call status error, Codex app-server failed/declined).
    expected: The failed call carries outcome "failed" and the declined app-server call carries "rejected" with an empty result; every other call has no outcome field at all, including results whose prose merely says "error"; no output text is sniffed.
  - name: loud-transcript-failures
    tags: [backend-api]
    test: packages/transcript/src/readers.test.ts
    code: packages/transcript/src/readers.ts
    description: Ask for unsupported, missing, malformed, and timestamp-less native transcript sources, and probe their revisions.
    expected: Each read returns an explicit unsupported, missing, invalid, or unreadable reason and an absent source's revision is null; no failure is represented as an empty successful transcript.
  - name: one-reader-per-harness
    tags: [backend-api]
    test: spec-cli/src/harness.test.ts
    code: spec-cli/src/harness.ts
    description: Inspect the registered adapters' transcript readers.
    expected: The four base harnesses carry four distinct readers, every headless adapter shares its base reader, and z-code's reader is the unsupported one.
  - name: open-interval-tail-parses-appends
    tags: [backend-api]
    test: packages/transcript/src/readers.test.ts
    code: packages/transcript/src/readers.ts
    description: >-
      Open a tail on a Claude thread before its file exists, then write an older stretch, the current prompt
      and a running call; advance; append the call's result cut mid-line, advance, complete the line and add a
      prose turn, advance; compare with a one-shot read of the same interval; overwrite the file with a shorter
      one and advance again.
    expected: >-
      The first advance fails as missing. After the write, the tail shows the prompt and the running call; the
      half-written result is carried, not parsed, until its newline lands, after which the result joins the
      call from the earlier advance and the prose follows; every turn carries an id, stable across advances;
      the one-shot read of the interval equals the cursor's snapshot; the shrunken file is read afresh.
  - name: every-turn-is-keyed
    tags: [backend-api]
    test: packages/transcript/src/readers.test.ts
    code: packages/transcript/src/readers.ts
    description: Read a Codex rollout whose event messages carry no ids, two of them on the same clock.
    expected: Each turn's id is `<role>@<at>`, with `#1` on the second turn that shares a clock, in thread order.
  - name: lazy-status-disclosure
    tags: [frontend-e2e, desktop, backend-api]
    test: spec-dashboard/test/session-surface-cold-readable.e2e.mjs
    code: spec-dashboard/src/TimelineChat.jsx
    description: Expand status rows through a prebuilt dashboard and isolated backend after the real archived session worktree has been removed.
    expected: Collapsed rows make no transcript request; expansion requests the interval once, renders turns, keeps tool output folded until a second click, reuses the cached result, and shows a human-readable unavailable reason for a missing transcript.
  - name: archived-codex-rollout-is-still-readable
    tags: [cli]
    test: packages/transcript/src/readers.test.ts
    code: packages/transcript/src/readers.ts
    description: Place a Codex rollout only under `archived_sessions/` (the dated `sessions/` tree empty) and probe the revision and read the interval through the codex reader.
    expected: The revision is non-null and the read returns the archived thread's turns; a thread Codex archived after a session closed is not reported as missing.
  - name: claude-steered-message-is-a-user-turn
    tags: [cli]
    test: packages/transcript/src/live.test.ts
    code: packages/transcript/src/parsers.ts
    description: Push a real `queued_command` attachment record (captured from a claude-headless session steered mid-turn) between two assistant records into a live Claude transcript, plus an unrelated attachment.
    expected: The queued command reads as a user turn keyed by the record's uuid, ordered between the calls it fell between, with its prompt text; the unrelated attachment is not a turn.
  - name: codex-0146-rollout-reads-each-message-once
    tags: [cli]
    test: packages/transcript/src/readers.test.ts
    code: packages/transcript/src/parsers.ts
    description: Read two real Codex 0.146 rollouts (one participant that answered in prose, one that answered only through tool calls) through the codex reader.
    expected: Each human message is one user turn with its plain text (never a JSON-encoded block array, never the AGENTS.md injection); each prose reply is one assistant turn (the response_item copy is not a second one); an agent that only called tools has tool turns and no prose turns.
---

The backend fixture proof is intentionally adapter-local and bounded. The browser scenario uses a real governed
session and native Claude JSONL in an isolated harness home, then removes that session's worktree before disclosure.
