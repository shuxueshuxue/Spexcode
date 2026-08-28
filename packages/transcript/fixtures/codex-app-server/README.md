# Codex app-server fixture

Captured from `codex-cli 0.146.0` on 2026-08-29 with `codex app-server --stdio`.

The client initialized a thread in a temporary directory and sent one `turn/start` prompt:
`Run \`printf ok\` in the shell and tell me the output.` Every server notification was recorded verbatim
to `~/spexcode-evidence/1787946166-codex-app-server/codex-app-server-notifications.jsonl`; the committed
JSONL redacts the local Codex home path and installation id.
