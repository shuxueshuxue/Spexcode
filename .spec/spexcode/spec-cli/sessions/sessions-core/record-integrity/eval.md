---
scenarios:
  - name: three-readings-stay-three
    tags: [cli, backend-api]
    code: [spec-cli/src/sessions.ts#readRecord]
    description: >
      In an isolated store put three governed sessions into the three states — no record file at all, a record
      whose bytes do not parse, and a record whose recorded worktree has been removed — then read `spex session
      ls`, `/api/sessions`, and attempt a lifecycle write on each.
    expected: >
      Absent is the legitimate nothing. The corrupt row survives, naming the file and the parse error with
      liveness `unknown`, and every writer refuses on it rather than repairing it into an empty shell. The
      retired row is terminal: no writer returns it to active/idle, no launch is assembled, only close remains.
      A transient read fault reads as none of the three and still throws.
  - name: a-note-round-trips-byte-for-byte
    tags: [cli]
    code: [spec-cli/src/sessions.ts#writeRecord]
    description: >
      Declare with notes containing a double quote, a backslash, a newline, and CJK text; read the record back
      through the CLI table, `--json`, and the HTTP projection.
    expected: >
      Every surface returns the note byte-for-byte, and the record stays parseable — the single typed writer is
      what makes arbitrary prose safe, and no hook, shell, or route composes those bytes.
---
# measuring record-integrity

The three readings are provoked separately because the defect this node exists to prevent is collapsing them.
