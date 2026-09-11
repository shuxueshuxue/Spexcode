---
title: zcode-atlas-workflow
status: active
hue: 30
desc: The whole atlas as one ZCode dynamic workflow — survey, write each part's spec in parallel, gate on lint, draw the pictures in parallel and gate each on its check, an independent read, commit, and one page as the run's artifact.
code:
  - distribution/zcode/atlas/skills/atlas/atlas.dwf.ts
---

# zcode-atlas-workflow

In ZCode the atlas of a whole repository is not a conversation, it is one dynamic workflow: a TypeScript script
the main agent submits with `CreateWorkflow`, whose subagents do the judgement while the script holds the
control flow and every check. `atlas.dwf.ts` is that script, shipped beside the ZCode skill, which tells the agent
to set the language and the phase names to the user's and change nothing else ([[distribution]]).

**Stages, each a phase the user approves and watches.**

1. *Read the repository and plan its spec tree.* A read-only surveyor names the source roots and extensions,
   what stays out of coverage, and three to twelve top-level parts by responsibility. A repository that already
   has a `.spec/` tree keeps it and skips straight to the gate.
2. *Write the spec for each part in parallel.* A lead writes `.spec/spexcode.json` (the lint scope the survey
   chose) and the root node; one writer per part writes that part's subtree, every source file ending up in some
   node's `code:` or `related:`.
3. *Check the spec tree and repair it until it passes.* The gate is `spex spec lint`: no errors, and coverage at
   or above the floor. One repairer carries the findings from round to round, for a bounded number of rounds. The
   tree is committed once it passes — `spex diagram scaffold` cites only committed files.
4. *Choose the nodes worth a picture*, by what each body spends its words on, the root always among them. Every
   pick is checked against the tree's node ids — the folder names the script itself listed — because a planner can
   hand back a name that is not a node (the first full run's planner appended a skip note to one); it gets one
   round to correct itself, and what still names nothing is reported as skipped, with that reason.
5. *Draw each picture and check it until it passes*, one cartographer per node in parallel, each gated on
   `spex diagram check` with a bounded number of repairs.
6. *Have an independent reader check the tree against the code*: claims at the top of the tree the code does not
   bear out, each re-read by a separate subagent and reported as verified or unconfirmed — never fixed silently.
7. *Build the browsable page and hand it over*: commit `.spec/`, write `spex graph --public --html`, publish it as
   the run's `atlas` artifact with a markdown report, and return the report.

**The script decides; subagents write.** Every check is a `world.run` whose exit code or output the script branches
on, never a subagent's claim that it passed. The lint reading is computed where it is produced — a small Node
program runs lint and prints only the counts and the first findings — because the workflow runtime rejects a
command's output over 256 KB and a large repository's full lint report would exceed it. A gate that cannot read
lint decides nothing, and no repair round can change that, so the run stops there and says why instead of looping
on an empty reading. Commits name `.spec` as their only path, so the user's other work in progress is never swept
into them.

**Nothing installed.** Every SpexCode command runs through npx; the page command adds the dashboard package
([[release-artifacts]]). The page is left uncommitted: it is a product of the tree, not part of it.

**Proof.** ZCode's own workflow analyzer (`analyzeWorkflowScript`, the check `CreateWorkflow` runs before asking
the user) accepts the script with no diagnostics. A script that compiles can still carry a command line that never
runs — the first real run found `node -e <program> -y …` handing npx's `-y` to node — so `npm run
test:distribution` runs the gate's exact argv, taken from the script, against a stand-in npx. The end-to-end proof is a headless ZCode run from the
dynamic-workflow branch — headless auto-approves `CreateWorkflow` and waits for the run to settle — on a real
repository with no `.spec/`, measured by what lands: a spec tree that passes lint, diagrams that pass their
check, and a page that opens from disk.
