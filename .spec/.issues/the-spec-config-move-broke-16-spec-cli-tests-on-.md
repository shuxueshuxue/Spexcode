---
concern: The .spec config move broke 16 spec-cli tests on main and the suite hang hid it
by: 8bb006f2-ff07-46c9-a216-83c6e32f7777
status: open
nodes: portable-layout, spex-uninstall
created: 2026-09-03T16:19:47.011Z
---

The `.spec/` config move landed on main with fixtures and a help assertion it never updated, and the
suite hang is why nobody saw it.

## The suite reading

`spec-cli`'s `npm test` cannot report at all — `graphScope.test.ts` holds the runner open forever
(spec-cli-npm-test-never-finishes-graphscope-s-tm). Excluding that one file gives the first terminating
reading of this package in a while: **118 files, 843 tests, 819 pass, 23 fail, 1 skipped.**

Rerunning only the 16 files that carry failures, serially (`--test-concurrency=1`) on an unloaded box
(load 4, `memory.pressure full avg10=0.00`), reproduces **22 of the 23**. The 23rd — `canonical npm run api
crosses the scrub boundary before the compiled CLI process tree starts` (`launcher-tsx.test.ts`) — passes
serially, so it is the only load-sensitive one.

## 16 of the 22 are one commit

`637060d6b feat: move project config under .spec` (2026-09-02, on main) rewrote every fixture that seeds a
project config from `<root>/spexcode.json` to `<root>/.spec/spexcode.json`. Where a fixture already creates
some other `.spec/...` path, `mkdirSync(dirname(spec), {recursive:true})` creates `.spec` on the way and the
write succeeds. Where it does not, the write now targets a directory that does not exist.

`graphStream.api.test.ts:406-419` is the clean case — the helper creates only `<project>/src`:

```ts
mkdirSync(join(project, 'src'), { recursive: true })          // cde0fb8ed5, 2026-08-10
writeFileSync(join(project, 'src', 'value.ts'), '…')          // cde0fb8ed5, 2026-08-10
writeFileSync(join(project, '.spec/spexcode.json'), '{}\n')   // 637060d6b7, 2026-09-02  <- line 410
```

Direct proof the write cannot succeed, with `project/src` present and `project/.spec` absent:

```
THROWS: ENOENT ENOENT: no such file or directory, open '…/project/.spec/spexcode.json'
```

**15 tests across 10 files die in setup on exactly that ENOENT**, in one to ten milliseconds, before
measuring anything: 4 in `graphStream.api.test.ts`, 2 in `harness.test.ts`, 2 in
`mentions-command.api.test.ts`, and one each in `runtime-rotate.cli.test.ts`, `session-diff.api.test.ts`,
`session-fail-chain.yatu.test.ts`, `session-files.api.test.ts`, `session-record-integrity.test.ts`,
`session-terminal-fixture.test.ts`, `session-web.api.test.ts`.

The **16th** is the same commit from the other side. It moved the sentence `spex help uninstall` prints:

```
- store. Your tracked intent (.spec including .plugins, plus spexcode.json) and surrounding user prose
+ store. Your tracked intent (.spec including .plugins, plus .spec/spexcode.json) and surrounding user prose
```

and left `uninstall.test.ts:95` asserting the old wording, so
`init → materialize → uninstall forgets every derived artifact for Claude-only and Codex-only repos` fails on
`/\.spec including \.plugins, plus spexcode\.json/`. `help.ts:309` blames to `637060d6b7`; the test line
blames to `ed5fb06ad0` (2026-07-20). Same rename, two halves, only one of them moved.

## The other 6 are separate, and pre-existing too

- `hook-dispatch.test.ts` ×2 (`session-listen: a queue it cannot read …`, `session-listen: a message it cannot
  deliver …`) — `SyntaxError: Unexpected end of JSON input` at `hook-dispatch.test.ts:404` and `:412`: the
  handler produced empty stdout where the test parses a JSON verdict.
- `graphStream.api.test.ts` — `a refused watcher source fails loud once and repairs on a bounded schedule,
  never per read` fails its own assertion after 11.1 s: *the missing worktree was never reported*.
- `sessions.test.ts` — `stop consumes one durable leaf receipt across unreadable, dead-pane, and crash-retry
  paths` fails with `Missing expected rejection` after 3.2 s.
- `session-close-probe.test.ts` — `close uses a target tmux probe when the global listing is busy` throws
  `ResourceConflict: refusing to stop …: exact target pane PID is unavailable` from
  `assertSessionLeafOwned` (`sessions.ts:3940`), i.e. the probe path the test exists to exercise refused.
- `session-help-cli.test.ts` — `Stop gate teaches human decisions and handoffs as asking` reports
  `ENOENT … /calls`, which is **not** the real failure: line 121 is
  `assert.equal(full.status, 0, \`${full.stderr}\ncalls=${readFileSync(calls,'utf8')}\`)`, and the message
  argument itself throws because the fake `spex` was never invoked, so no `calls` file exists. The gate exited
  non-zero and the diagnostic that would say why destroyed itself. Worth fixing as its own defect — an
  assertion message must not be able to throw — independently of whatever makes the gate exit non-zero.

## Not this branch

`node/hi-8bb0` touches 11 files under `spec-cli/src` (`gateway*`, `host*`, `machine-peer*`) and **none of the
16 failing test files**: `git diff main...HEAD` is empty for every one of them. Only `session-web.api.test.ts`
even imports a module this branch changed (`./gateway-hub.js`), and its failure is the ENOENT above, in
fixture setup, before any gateway code runs. Confirmed by rerunning the same 16 files serially on trunk
`/home/jeffry/spexcode` main (`4a9568b00`): **210 tests, 188 pass, 22 fail**, and the set of 22 failing test
names is byte-identical to the branch's. This branch introduces none of them.

## Why it went unnoticed

A suite that never terminates cannot report a regression. `637060d6b` touched 37 test files and broke
sixteen of them; the hang is the reason that was invisible. Fixing the hang is what makes this class of
breakage visible again, which is why the two findings belong together.
