---
title: cli-surface
status: active
hue: 200
desc: The spex command surface — noun-first grammar (spex <noun> <verb>), one spelling per verb, signposted removals, machine plumbing under `internal`, and a three-layer help journey.
code:
  - spec-cli/src/cli.ts
related:
  - spec-cli/src/guide.ts
  - docs/AGENT_GUIDE.md
  - spec-cli/src/help.ts
---
# cli-surface

## raw source

The `spex` top level is exactly the vocabulary a human or agent is meant to type — nothing more, and
each thing in it has exactly ONE spelling. Commands read noun-first: `spex <noun> <verb> [object]
[flags]`. A verb only programs call lives under `spex internal`, out of sight. No help probe may
dead-end, and no removed spelling may fail mutely: it names its replacement.

## expanded spec

**The grammar.** `spex <noun> <verb> [object] [flags]` — the verb is always the token immediately
after its noun, so an id can never occupy a verb slot and no id is a reserved word. Six noun drawers
(`spec` · `session` · `eval` · `issue` · `remark` · `evidence`), plus bare project verbs (`graph` ·
`init` · `materialize` · `doctor` · `serve` · `dashboard` · `uninstall`) allowed only because their
object is invariably THIS project (`dashboard`'s object is the HOST's project set — still no free
object slot), plus the two help surfaces (`help` · `guide`). A bare noun prints its
drawer's help and exits clean — there is no implicit default action. A verb reused across drawers
must mean the same thing everywhere (`ls` lists a collection, `add` appends a record, `open`/`close`
are lifecycle, `retract` is the author withdrawing their own record). Sub-command vs flag follows one
rule: a distinct action, state transition, process, or self-categorized report is a verb; a filter,
an alternate representation of the same read, a parameter of the same write, an input encoding, or
routing (`--api`/`--port`) is a flag — which is why `doctor --contract`/`--conflicts`,
`eval ls --session <SEL>`, and `issue links --pending` are flags, while `eval lint` (a report with
its own finding classes) and `serve ui` (a different process) are verbs.

**One verb, one spelling.** The old verb mirror (promoted session verbs + bare session subs) is
gone, as is every deprecated alias: there are no two spellings that reach one handler, and nothing
that "still runs but warns". The raw-key escape hatch is not a verb but the last-resort face of one:
`session send <SEL> --keys "<keys>"` — every surface that teaches it (help, the session drawer
entry, the contract block) must mark it unstable and say "try a plain send first", because the raw
key path can confirm dangerous dialogs.

**Signposts, one version only.** Every spelling v0.3.0 removed (the bare promoted verbs, the bare
session subs, `yatsu`/`blob`/`issues`/`forge`/`tree`/`board`, top-level
`search`/`owner`/`lint`/`ack`, `resolve`/`retract`, `session rawkey`, `session exit|reopen` (respelled
`stop`/`resume`), `session capture|prompt` (folded into `show`), the hook verbs
`session state|fail|idle|commit-gate`, positional `doctor contract|conflicts`, `review proof`) maps
to a signpost: one stderr line naming the new spelling, exit non-zero, and the old verb NEVER
executes — a signpost is a tombstone, not an alias. Signposts are term-limited compatibility, removed
after their supported upgrade window rather than becoming a permanent second vocabulary. Consequence accepted:
a stale deployed hook that still calls an old spelling gets a readable failure (the pre-commit shim
degrades advisory, the stop-gate's commit check reads "not ready" with the signpost as its reason)
until `npm run hooks` refreshes it — visible degradation over silent wrong
behavior.

The retired `spex session new --node <id>` flag follows the same tombstone rule: it exits non-zero and tells
the caller to put a `[[<id>]]` mention in the prompt because the first mention binds. It never launches a
session. This is a removal signpost, not a second node-binding input.

**The internal boundary.** Machine plumbing — `trunk`, `commit-surgery`, `refresh-footprint`,
`check-staged`, `session-state`/`session-fail`/`session-idle`/`commit-gate`, `nudge`,
`session-turn-fail`, `codex-launch`/`codex-turn`, `claude-headless-run`, and `spec-governors` (the hook-stable `id<TAB>spec-path` projection of a
file's real `code:` owners) — is namespaced under `spex internal`, absent from the map; its usage
text tells a stray human which porcelain they probably wanted. The typeable worker declarations
(`session done|park|ask`) stay porcelain: an agent types them.

**The three-layer help journey** — each layer states what the next one is for, so the reader always
has a move:

1. `spex help` — the map: the grammar itself (noun-verb order, bare-noun help, safe probes), every
   drawer and project verb, and the cross-cutting conventions stated ONCE (SEL, `.`, `--json`,
   `--api`/`--port` routing, the mention grammar).
2. `spex help <command>` / `spex <command> --help` — ONE drawer/command's usage. The `--help`
   interception still fires BEFORE any verb runs ([[guide]]'s safety contract: probing `session new`
   or `session watch` with `--help` must never start the verb); a drawer sub's probe answers with its
   drawer's entry.
3. `spex guide [topic]` — the skill layer ([[guide]]): workflows, file formats, settings. **help
   answers "what do I type", guide answers "how do I work".**

Dead-end rule: an unknown command, unknown drawer verb, unknown help topic, unknown guide topic, and
a bare `spex internal` each fail loud AND name the layer to go back to; a removed spelling fails
loud AND names its replacement — never a silent exit.

A machine dump names its human twin: `spex graph --json` is for programs, so when stdout is a tty a
single stderr line points at the readable `spex graph`. The hint is stderr-only and tty-gated, so
piped output stays byte-identical.

The map must stay honest: every porcelain verb `cli.ts` dispatches appears in it (a hidden typeable
verb is the bug this node exists to prevent), and capabilities that do not exist yet appear nowhere
— help grows a line only when the verb lands. `cli.ts` remains the thin dispatch hub — verbs' logic
lives in their own modules; help text lives in `help.ts`; a sibling verb's churn in the hub is that
feature's, not this node's drift.
