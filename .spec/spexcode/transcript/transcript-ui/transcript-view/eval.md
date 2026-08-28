---
scenarios:
  - name: a-seam-draws-the-agents-work-not-the-conversation
    tags: [frontend-e2e, desktop]
    test: spec-dashboard/test/transcript-dedup.e2e.mjs
    code: packages/transcript-ui/src/TranscriptView.tsx
    related:
      - spec-dashboard/src/TimelineChat.jsx
      - spec-dashboard/src/styles.css
    description: >-
      Through the running dashboard's real Sessions route, open Conversation for a codex-headless session in the
      exact reported shape: the launch prompt is the record's originating prompt (drawn once at the top), a
      `queued` row sits between it and the working seam, and the seam's transcript payload begins with that same
      launch prompt as its first user turn, followed by the agent's prose and tool calls. Expand the seam and
      read what it draws.
    expected: >-
      The prompt appears exactly once in the conversation — the quote at the top — and never again. The expanded
      seam draws only the agent's work (its prose and tool sentences); no user turn is rendered inside it, so
      the `queued` row between the quote and the seam cannot defeat any dedup, because there is none to defeat.
      This holds even for a user turn the record does not carry (typed into a harness directly): it is a work
      boundary, not a row. Before the fix the same payload drew the prompt a second time inside the seam.
---
# measuring transcript-view

The loss signal is the real conversation surface: a seam renders the agent's work, and every message lives on
the record exactly once. The scenario reproduces the reported duplication — a `queued` row between the prompt
and the seam used to null the positional opener lookup, so the prompt was re-drawn inside — and proves the
seam now carries no user turn at all. The companion live-tail scenario ([[message-stream]]) proves the same
boundary rule holds in the open seam's collapsed face.
