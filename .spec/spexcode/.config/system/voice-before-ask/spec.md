---
title: voice-before-ask
status: active
hue: 320
desc: A config plugin — agents speak a question aloud via the voice MCP before asking the human.
code:
---
# voice-before-ask

Before asking the human a question (`AskUserQuestion` or `spex session ask`), the agent first **speaks
it aloud** via the voice MCP (`voice/say`), so a human who isn't watching the text is never left blocked
on an unspoken prompt.

This is a **system** node ([[surface]] = its `system/` location): the rule is folded into every launched
agent's system prompt as an always-on contract.

It ships a co-located `setup.sh` that registers the voice MCP when it is absent, so the capability is
self-provisioning rather than assumed. The MCP is user-scoped (tool `voice/say`, source at
`~/Codebase/claude-voice-mcp`); the script is **idempotent** — a no-op when `voice` is already
registered, and it touches no other MCP. If the MCP source is missing it fails loud, leaving the rule
visibly unbacked rather than silently asking in text only.
