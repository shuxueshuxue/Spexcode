---
scenarios:
  - name: quarantine-proves-absence-before-it-moves-a-byte
    tags: [cli, backend-api]
    code: [spec-cli/src/sessions.ts#quarantineCorruptRecord]
    description: >
      Against a corrupt governed record, run quarantine while its registered leaf process is still alive, then
      while its tmux session still exists, then with a named native thread that is loaded and active, and finally
      with every claimed resource genuinely absent. Then run restore, twice.
    expected: >
      Each live, active, owned, ambiguous, or unknown control refuses loudly before the record moves, sending no
      signal and removing no worktree or branch. The clean case atomically moves only `runtime.json` to the
      per-project bundle with its byte-exact payload plus the observed absence proof, and the row leaves the list,
      graph, and resource projections through ordinary enumeration. Restore moves the byte-identical record back
      only while no active record exists; the second restore refuses.
---
# measuring record-quarantine

Every refusal path is exercised against a real corrupt record, because the operation's whole value is that it proves.
