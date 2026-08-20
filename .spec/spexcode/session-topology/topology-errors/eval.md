---
scenarios:
  - name: installed-topology-fails-in-its-own-language
    tags: [backend-api]
    description: >
      Install packed protocol and topology packages in a clean consumer, provoke every public topology error category,
      and record each thrown constructor, stable code, and public message.
    expected: >
      Every failure is a TopologyError with its specified TOPOLOGY code, no topology failure uses a PROTOCOL code, and
      unknown-session or constraint failures expose no raw SQLite diagnostic in the public message.
---
# session topology error loss

Measure failures through the installed public entry. The transcript enumerates expected and actual code populations,
including the number of raw storage diagnostics observed.
