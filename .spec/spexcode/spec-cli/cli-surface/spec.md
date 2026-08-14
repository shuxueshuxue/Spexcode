---
title: cli-surface
status: active
hue: 200
desc: The spex command surface — noun-first grammar (spex <noun> <verb>), one spelling per verb, signposted removals, machine plumbing under `internal`, and a three-layer help journey.
code:
  - spec-cli/src/cli.ts
related:
  - spec-cli/src/guide.ts
  - spec-cli/src/help.ts
  - spec-cli/src/session-declarations.ts
  - spec-cli/src/session-send-cli.test.ts
  - spec-cli/src/session-create-cli.test.ts
  - spec-cli/src/session-ls-cli.test.ts
  - spec-cli/src/session-declarations.cli.test.ts
  - spec-cli/src/unknown-command-cli.test.ts
---
# cli-surface

## raw source

The `spex` top level is exactly the vocabulary a human or agent is meant to type — nothing more, and
each thing in it has exactly ONE spelling. Commands read noun-first: `spex <noun> <verb> [object]
[flags]`. A verb only programs call lives under `spex internal`, out of sight. No help probe may
dead-end, and no removed spelling may fail mutely: it names its replacement.

The process-inspection exception is `spex --version` (with `-v` as its compact flag spelling): it prints
the installed root package version and exits before command routing. It is not a project verb, so it neither
needs a repository nor enters the noun-first command map.

## expanded spec

**The grammar.** `spex <noun> <verb> [object] [flags]` — the verb is always the token immediately
after its noun, so an id can never occupy a verb slot and no id is a reserved word. Seven noun drawers
(`spec` · `session` · `peer` · `eval` · `issue` · `remark` · `evidence`), plus bare project verbs (`graph` ·
`init` · `materialize` · `doctor` · `serve` · `dashboard` · `guidance` · `uninstall`) allowed only because their
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

`peer` is the host-level machine-link drawer: `spex peer connect <SSH-ADDRESS>` establishes a durable
[[machine-peer]], `spex peer ls` reports the known links, and `spex peer disconnect <SSH-ADDRESS>` explicitly
retires one. `spex session show --ssh <SSH-ADDRESS> <FULL-SESSION-ID>`, `spex session send --ssh <SSH-ADDRESS>
<FULL-SESSION-ID> <text>`, and `spex session close --ssh <SSH-ADDRESS> <FULL-SESSION-ID>` are the first
corresponding remote session faces. The address stays opaque to SpexCode — `user@host`, a `Host` alias, and any
SSH-config spelling are passed to SSH without product parsing. `--ssh` is a transport parameter for these
id-addressed verbs, not a rival routing grammar: once a known peer resolves it, the verb uses the ordinary
explicit remote transport path. Operations which need a remote project context, such as `ls` and `new`, do not
borrow the caller's local cwd and therefore stay outside this first group.

`spex spec lint --json` is the machine representation of the same blocking report, not another lint
verb: it emits the [[spec-lint]] versioned report on stdout while retaining lint's error-derived exit code.

The `flat` drawer exposes three real verbs: `flat new` measures a repository into a spec tree, `flat site`
emits a relocatable graph-only static site, and `flat gallery` assembles several sites under one index.
These bounded conversion/preview operations do not create sessions, serve a backend, or push the target.

The resource surface keeps one lifecycle: `spex session resources [--json]` is the self-categorized, read-only
host report. It may explain reclaim eligibility but never issues mutation authority; stop and close remain the
only lifecycle verbs that release session resources. Both take a selector naming ANOTHER session, and every
surface that teaches them says so — the same obligation the raw-key escape hatch carries. `close` is also a
declaration word (`done --propose close`), and the two differ in who acts: a manager retiring a lane it
dispatched, versus a worker proposing its own end for the human to perform. Any prose that nudges an agent to
reclaim what it started — the propose-close cleanup nudge included — scopes its sweep to what the agent
spawned and excludes the running session by name, because `.` and a bare own id are valid selectors here.

Objects and payloads are parsed by role after recognized flags and their values are removed, never by a fixed
`process.argv` slot. Thus a routing flag may follow a selector before or after a write payload without becoming
that payload. Each valued flag occurs at most once with exactly one non-empty value; alternate routing flags are
mutually exclusive. An option-shaped payload uses the ordinary `--` end-of-options delimiter instead of being
guessed from quoting or whitespace. That delimiter is authoritative for the entire invocation: routing, TLS,
and authentication consumers read only the option prefix, so payload bytes can never become control flags again
downstream. A write with a missing or extra positional, duplicate/missing flag value, or unknown flag fails before
selector resolution or backend contact; a usage error can never print the write's success receipt.

`VALUE_FLAGS` is the one declaration of which recognized options consume their following token while the shared
positional scanner runs. A per-verb `rejectUnknownFlags` allowlist says only that an option is permitted; when that
verb reads an allowed option through `flag(name)`, a source-level guard requires `--${name}` in `VALUE_FLAGS`.
Therefore a new valued option cannot be accepted and then silently reclassified as a positional payload: the test
fails until the one value declaration is updated.

`spex session reparent <child-SEL...> --to <parent-SEL>` is the manager recovery verb for moving a fleet to a
replacement supervisor. `--to` is the operation's required destination rather than a second positional list:
the resulting command reads naturally, permits a batch of children, and gives a missing parent an unambiguous
usage error. It is a mutation like `send` or `rename`, so normal backend routing flags apply; its parent and
watch semantics belong to [[session-reparent]], not to the generic grammar.

`spex session quarantine <ID> --adapter <harness> [--thread <native-id>] --tmux <id> --worktree <absent-path>
--branch <absent-branch>` is the separate record-integrity control for an unreadable row. It moves no worktree,
branch, process, or readable lifecycle record: the backend consumes its exact absence witness before it moves
opaque bytes out of active projection. Its optional `--thread` is an adapter-native conversation id, not the
SpexCode session id; callers omit it when the named adapter has no native thread to archive, including Claude.
Both it and `--restore` require the original exact id rather than a
selector, because corrupt rows never belong to selector enumeration.

`--ssh <address>` is a transport selection, not a competing command grammar. On every peer-enabled session
verb, its first positional is the complete remote session UUID: show/send/close address that row, while ls/new
use it only as the remote project's derivation anchor. The latter accepts no second selector and introduces no
`--project`, `--root`, or URL-shaped target flag. This preserves one reusable peer locator and makes the only
otherwise-unavailable piece of routing information explicit without teaching the CLI dashboard URLs or remote
filesystem paths.

`session ls` names a collection, not an implied supervisor tree: bare `ls` remains the project-wide board for
scripts and human operators. `--children` changes only that read scope to the governed caller's direct children;
`--children=<PARENT-SEL>` names another direct-parent scope in an attached value, deliberately leaving a
following positional as the ordinary result selector (`ls --children <SEL>`). Scope precedes the existing
selector and status filters, so a caller can ask for one child without changing the meaning of `SEL`. The table
must expose every row's direct parent and summarize the displayed scope by status. A peer list has no remote
caller identity, so its child scope requires the explicit attached parent selector.

**One verb, one spelling.** The old verb mirror (promoted session verbs + bare session subs) is
gone, as is every deprecated alias: there are no two spellings that reach one handler, and nothing
that "still runs but warns". The raw-key escape hatch is not a verb but the last-resort face of one:
`session send <SEL> --keys "<keys>"` — every surface that teaches it (help, the session drawer
entry, the contract block) must mark it unstable and say "try a plain send first", because the raw
key path can confirm dangerous dialogs. A plain-text `session send` prints `sent` on stdout ONLY after its
backend accepts the message; any backend refusal prints the named dispatch reason on stderr and exits non-zero,
so a stranded native transport cannot look like a successful command in scripts or a terminal.

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
`check-staged`, `session-state`/`session-fail`/`session-idle`/`commit-gate`, `hook-prompt`, `nudge`,
`session-turn-fail`, `shared-runtime-spawn`, `codex-launch`/`codex-turn`, `claude-headless-run`, and `spec-governors` (the hook-stable `id<TAB>spec-path` projection of a
file's real `code:` owners), and `hook-prompt` (the hook-stable renderer for model-facing hook text) — is namespaced under `spex internal`, absent from the map; its usage
text tells a stray human which porcelain they probably wanted. The typeable worker declarations
(`session done|park|ask`) stay porcelain: an agent types them. `session done --propose nothing` is an
intended correction trap rather than a state write: it exits non-zero after naming merge, close, ask, and
park as the only real destinations, so an agent cannot accidentally retain a completed lane by default.

**The three-layer help journey** — each layer states what the next one is for, so the reader always
has a move:

1. `spex help` — the map: the grammar itself (noun-verb order, bare-noun help, safe probes), every
   drawer and project verb, and the cross-cutting conventions stated ONCE (SEL, `.`, `--json`,
   `--api`/`--port` routing, the mention grammar).
2. `spex help <command>` / `spex <command> --help` — ONE drawer/command's usage. The `--help`
   interception still fires BEFORE any verb runs ([[guide]]'s safety contract: probing `session new`
   or `session watch` with `--help` must never start the verb). A noun-verb probe such as
   `spex session wait --help` answers with that VERB's exact usage, projected from the same definition
   the bare `spex session` drawer assembles; exact help never carries a copied second manual. Shared
   selector grammar and project-bound write warnings follow the relevant verb into that projection.
3. `spex guide [topic]` — the skill layer ([[guide]]): workflows, file formats, settings. **help
   answers "what do I type", guide answers "how do I work".**

Dead-end rule: an unknown command, unknown drawer verb, unknown help topic, unknown guide topic, and
a bare `spex internal` each fail loud AND name the layer to go back to; a removed spelling fails
loud AND names its replacement — never a silent exit. A top-level unknown command also consults the
public command table as a nearest-intent catalog: when a candidate is close enough, the rejection names
that real command as the repair while retaining `spex help` as the map; an unrelated token offers only
the map rather than inventing a command. This is one derived matcher over the command surface, never
a per-typo alias table, so a guessed `list` or `nodes` can route to `spex graph`, the real spec-node tree.

Naming the layer is not the whole duty when the message also names the ALTERNATIVES, because a list can be
complete, loud, and wrong at once. Where those alternatives are a registry ANOTHER module owns, the hub
derives the list from that registry and never re-types it; where they are the sibling `if` branches in this
same file, a literal list stays literal — it sits beside the thing it describes, so a reader adding a branch
sees it. The guide-topic list was the first kind written as the second and shipped two topics behind
([[guide]] holds `TOPICS`, the hub held a copy), and nothing about the short list looked wrong: an
enumeration cannot report what it is missing. That failure mode is silent by construction, which is why the
rule is about where the list's truth LIVES rather than about keeping copies in step.

A machine dump names its human twin: `spex graph --json` is for programs, so when stdout is a tty a
single stderr line points at the readable `spex graph`. The hint is stderr-only and tty-gated, so
piped output stays byte-identical.

The map must stay honest: every porcelain verb `cli.ts` dispatches appears in it (a hidden typeable
verb is the bug this node exists to prevent), and capabilities that do not exist yet appear nowhere
— help grows a line only when the verb lands. `cli.ts` remains the thin dispatch hub — verbs' logic
lives in their own modules; `session-declarations.ts` owns the worker-authored `done` / `park` / `ask`
record declarations; help text lives in `help.ts`; a sibling verb's churn in the hub is that feature's,
not this node's drift.

The hub rule has a MECHANISM, and stating only the rule leaves the mechanism unprotected. Every dispatch site
reaches its verb through a lazy `await import(...)` — around eighty of them, one per verb — and the point is
what a single invocation must NOT pay for: `spex session ls` cannot afford to load the eval engine, the harness
adapters, the forge drivers and every other verb's module before it prints a row. So a module graph that keeps
each verb's logic in its own file while importing all of those files EAGERLY satisfies the sentence above and
loses the property the sentence exists to buy. Both halves are the contract: logic lives elsewhere, AND the hub
reaches it only when that verb is the one being run.

The corollary is a refusal, and it is worth naming because the pressure to break it arrives disguised as
tidying: when some other module turns out to be hosting a CLI surface at the wrong altitude, the hub is NOT its
new home. Moving that surface's implementation here would trade one module hosting two altitudes for another
doing the same — the hub would begin holding argv parsing AND verb bodies, which is the shape it is defined
against. Such a surface goes to a module of its own, and the hub gains one more lazy line pointing at it.
