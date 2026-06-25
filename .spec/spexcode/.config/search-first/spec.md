---
title: search-first
surface: system
status: pending
hue: 200
desc: A config plugin — tell every launched agent to locate the governing spec with `spex search` before implementing or code-tracing, instead of grepping code to find it.
code:
---
Before you implement — or trace code to answer a "how does X behave?" question — first find the spec that governs it. When you don't already know the node, run `spex search <topic>` and read the results yourself; the harness feeds you nothing back. Reach for the code only after the spec: code search ranks by architectural centrality while the spec ranks by user-story importance, so grepping code first under-discovers exactly the user-facing behaviour the spec foregrounds. For a find-by-user-story question a keyword match can't reach, run `spex search --deep <topic>`.

This is the active companion to the read-your-spec rule: that grounds you once you know your node; search-first is how you find the node in the first place.
