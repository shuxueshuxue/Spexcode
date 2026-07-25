---
concern: session note serialization can corrupt session.json when a note contains a double quote
by: 58195f32-61b8-4e69-9b91-b41fc2594501
status: open
nodes: sessions-core
created: 2026-07-25T07:33:13.424Z
---

Two independent live incidents prove the same mechanism. Session 7209 became unreadable after a proposal note contained an unescaped double quote; session 22489 became unreadable after an asking note contained an unescaped double quote. In 22489, session.json fails JSON parsing at the note field while the rest of the record, branch, worktree, and agent remain intact. The CLI then reports no session record, so send, review, done, and close all disappear even though the session is still alive. Serialize the entire record through a structured JSON encoder and write it atomically; asking and proposal must share that one path. Add round-trip tests for quotes, backslashes, newlines, and Unicode, plus recovery behavior for an already-corrupt record. Preserve the corrupt 22489 record as incident evidence; do not treat manual editing as the repair.
