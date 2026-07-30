---
concern: [[harness-adapter]] materialize whole-file-replaces .claude/settings.json, destroying user enabledPlugins (write/clean asymmetry)
by: f01f57f2-0843-4acc-894d-a3a85059bb8e
status: open
nodes: harness-adapter
created: 2026-07-30T10:09:28.905Z
---

materialize whole-file-replaces Claude's `.claude/settings.json`, destroying every top-level key that is not `hooks` — including a user's tracked `enabledPlugins`.

**Observed (z-code, fresh `node/cr-listener-3e0d` worktree)**: after materialize, tracked `.claude/settings.json`
went from HEAD's user config (with `enabledPlugins`) to Spex hooks only — unstaged **72+/3-** — which both violates
the non-overwrite adoption contract and blocks declaration (the worktree can no longer be committed clean).

**Root cause** — `spec-cli/src/harness.ts:1828`:
```ts
function buildShim(id, events, dispatch, spex) {
  const hooks: Record<string, unknown> = {}
  for (const e of events) hooks[e] = [{ hooks: [{ type: 'command', command: cmd(e) }] }]
  return { content: JSON.stringify({ hooks }, null, 2), cmd }   // ← a COMPLETE file body containing only `hooks`
}
```
That content is written with `writeFileSync(file, out)`, and for Claude `shimFile` **is** the user's settings file
(`:2111 → join(proj, '.claude', 'settings.json')`). So the write path replaces the whole document. `enabledPlugins`
appears **nowhere** in `spec-cli/src`, so this is not a merge bug — the writer has no merge concept for this file at all.

**The contract it violates is stated in this same file.** `cleanHarness` (:1930-1933) documents that clean removes
"ONLY our own blocks and our own named products — never a user's CLAUDE.md/AGENTS.md prose, **a hand-made
settings.json**, or a sibling skill/agent the user added". So *clean* is careful to preserve a hand-made
settings.json while *write* clobbers it wholesale. The asymmetry is the defect.

**Why only Claude.** Markdown contract files fold in via sentinel-delimited managed blocks
(`removeManagedBlock(f, ['<!-- ', ' -->'])`), i.e. host-file-preserving. JSON has no comment sentinel and no
managed-subtree analogue was built. Comparing shim targets: codex `.codex/hooks.json`, pi
`.pi/extensions/spexcode.ts`, opencode `.opencode/plugins/spexcode.ts` are all **dedicated, wholly-ours** files —
**Claude is the only harness whose shimFile is a SHARED user config document**, which is why only it is exposed.

**Minimal contract (owner's call; I am not writing product code)**: the Claude shim write must be a *merge into*
`.claude/settings.json` that owns only the `hooks` subtree and preserves every sibling key byte-for-byte when
unchanged — the JSON analogue of the markdown managed block — and must be idempotent so repeat materialize
produces no diff. Symmetry check: whatever identity gate write uses must be the one `cleanHarness` already relies on.

Scope note: this fires on any project where `.claude/settings.json` is tracked and carries non-`hooks` keys, so it
is not specific to z-code or to the 3e0d lane. 3e0d is restoring exact HEAD bytes only and the fix must not be
mixed into the retry lane.
