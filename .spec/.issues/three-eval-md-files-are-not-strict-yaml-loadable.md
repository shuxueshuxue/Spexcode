---
concern: Three eval.md files are not strict-YAML-loadable, so external tooling silently undercounts the scenario corpus
by: 8bb006f2-ff07-46c9-a216-83c6e32f7777
status: open
nodes: measurement-sidecar
created: 2026-09-03T12:49:09.355Z
---

Spec: measurement-sidecar

Three `eval.md` files in this repo are not loadable by a strict YAML parser, though the product's own reader
parses them correctly. Found while taking a corpus census, not while chasing a bug.

  spec-cli/sessions/harness-adapter/codex-headless/eval.md   13 scenarios
  spec-cli/sessions/ls-cjk-width/eval.md                      3 scenarios
  transcript/eval.md                                          2 scenarios

Cause is unquoted plain scalars YAML cannot accept:

- `codex-headless` has `expected: The session is online with \`{ headless: true }\`; …`. The inner `: ` makes YAML
  read a nested mapping, so the load fails with "mapping values are not allowed here".
- `transcript` has an `expected:` whose value begins with a backtick. A backtick is a reserved indicator in YAML,
  so a plain scalar may not start with one.

WHY THIS IS WORTH RECORDING RATHER THAN SHRUGGING AT. The product reads all 18 scenarios — `spex eval scenario ls
<node> --json` returns 13, 3 and 2 rows, matching a raw `- name:` count — so no measurement is lost today and
nothing is broken for a user. The cost is external: the frontmatter is documented and shaped as YAML, so any
tool that is NOT this product (a CI check, an editor's yaml mode, a yaml linter, a one-off census script) reads
the corpus through a strict loader and silently sees 1,132 scenarios instead of 1,150. It does not error; it
returns a smaller plausible number. That is the failure direction that has cost this session the most this week.

Two independent census attempts, mine and a peer session's, both undercounted for this reason — 1,132 and 1,117
against the true 1,150 — and neither run reported a problem.

WHAT WOULD SETTLE IT, in increasing order of cost:

1. Quote or block-scalar the offending `expected:` values in those three files. Smallest fix, restores
   strict-loadability, changes no scenario identity or measurement.
2. Have `spex eval lint` flag an `eval.md` whose frontmatter does not load under a strict YAML parse. This makes
   the implicit tolerance explicit and stops the corpus drifting further from the format it advertises. Advisory
   fits the existing lint contract, which is already advisory and always exits 0.

Not fixing either here: this is outside the branch's scope (node/hi-8bb0 is the machine-routing lane) and option
2 is a policy change to the measurement layer's gate, which should be a deliberate decision rather than a
drive-by.

Related note for anyone writing tooling against this corpus: an anchor may carry a symbol suffix
(`spec-cli/src/doctor.ts#doctor`), 331 of them across 117 scenarios. The product resolves those into
`{path, selectors}` and merges same-file anchors into one entry, so it never trips. A script that hands a
`#`-suffixed path to `git diff` as a pathspec matches zero files and reads it as "unchanged" — another silent
clean. Strip the suffix before touching git.
