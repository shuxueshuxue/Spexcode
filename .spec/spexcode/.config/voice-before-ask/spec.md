---
title: voice-before-ask
surface: system
status: active
hue: 320
desc: A config plugin — agents speak a question aloud via the voice MCP before asking the human.
code:
---
Before asking the human a question (via `AskUserQuestion` or `spex session ask`), first speak it aloud through the voice MCP (`voice/say`). A human who isn't watching the text must never be left blocked on an unspoken prompt.
