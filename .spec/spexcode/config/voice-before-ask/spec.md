---
title: voice-before-ask
status: pending
hue: 320
surface: system
desc: A config plugin — agents speak a question aloud via the voice MCP before asking the human.
code:
---
# voice-before-ask

Before an agent asks the human a question, it **speaks the question aloud** through the voice MCP tool,
so a human who isn't watching the text is never left blocked on an unspoken prompt. The plugin delivers
this rule on the `system` [[surface]] — the contract is injected into every launched agent's system
prompt — and **ships a setup script in its own folder that installs the voice MCP server when it is
absent**, so the capability is self-provisioning rather than assumed. With the MCP present the agent
voices each question first; if installation is impossible the plugin fails loud rather than silently
asking in text only.
