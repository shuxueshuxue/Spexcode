# distribution

SpexCode's atlas — the skill that reads a repository into a spec tree, draws its architecture diagrams and hands
over one browsable page — packaged in the format of each host that installs agent add-ons. Nothing here is part of
SpexCode itself: SpexCode's own skills and hooks live in `.spec/spexcode/.plugins/`, and these folders are what other
products load. Every package runs SpexCode through `npx`, so a user installs nothing and configures nothing.

| Folder | Host | What the host gets | Install it |
| --- | --- | --- | --- |
| `claude-code/atlas` | Claude Code | a plugin with the `atlas` skill, invoked as `/atlas` | `claude plugin marketplace add shuxueshuxue/spexcode-plugins` then `claude plugin install atlas@spexcode` |
| `codex/plugins/atlas` | Codex | a plugin with the `atlas` skill, invoked as `/atlas` | `codex plugin marketplace add shuxueshuxue/spexcode-plugins` then `codex plugin add atlas@spexcode` |
| `zcode/atlas` | ZCode | a plugin with the `atlas` skill, plus `atlas.dwf.ts`: the whole job as one dynamic workflow | list the folder in `plugins.dirs` |
| `gugu/spexcode` | gugu | an App: beside a task, its working copy's spec tree with drift and each node's diagram; "Start here" / "Cite" hand a node to a gugu session; the `atlas` and `spexcode` skills for gugu's agents | the App page → install from folder, pick the folder |
| `penguin/use-spexcode` | PenguinHarness | a library plugin with the `atlas` skill | upload `skills/atlas` as a zip, or copy it into an agent's `agent_state/skills/` |

**This directory IS a marketplace root, and it is installed from a mirror.** Claude Code and Codex both resolve a
plugin out of a marketplace and neither installs a bare plugin directory, so the two manifests that name the same
plugins sit here — `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json` — and one directory
serves both. A plugin manifest that VALIDATES is not a plugin that installs: `claude plugin validate` passes on a
bare plugin folder that `claude plugin marketplace add` then refuses.

Both hosts clone the WHOLE repository a marketplace names, and the `owner/repo` form reads the manifest only at the
repository ROOT — a subdirectory cannot be addressed. Pointing adopters here would cost them 33M and 1605 files for
a skill that is four, so this directory is mirrored to
[`shuxueshuxue/spexcode-plugins`](https://github.com/shuxueshuxue/spexcode-plugins) (1.2M, 23 files), which holds
nothing else. `.github/workflows/distribution-sync.yml` keeps the two equal and runs only when this directory
changes; it regenerates first and fails if what is committed differs from what the generator writes. Edit here,
never there.

Claude Code and Codex both expose a plugin skill as a native slash invocation, so the installed `atlas` skill is
started by typing `/atlas`; this package does not add a second Claude `commands/` file or a Codex `prompts/` file.
ZCode has no equivalent slash-command package surface here, so its distribution keeps the `plugins.dirs` plugin and
the hand-written `atlas.dwf.ts` workflow. gugu gives the skill to its agents (Claude Code and Codex sessions in
gugu list it as their own) and has a Draw button in its tab. PenguinHarness reads the skill from its
`agent_state/skills/` library path and offers no corresponding `/atlas` entrypoint.

**Generated or written by hand.** `npm run build:distribution` writes every manifest, every `SKILL.md`, the gugu App's
prompt, its pinned spex command (`spex-command.js`), its icon and its copies of archify (`archify.mjs`, `focus.js`,
`diagram.css`) from their sources: the atlas preset in
`.spec/spexcode/.plugins/skills/atlas/`, the root version, and `packages/archify`. `npm run lint` fails while any of
them is stale. The rest was written by hand and the generator never touches it: `zcode/atlas/skills/atlas/atlas.dwf.ts`,
the gugu App's `index.html`, `app.js`, `tools.js`, `spex-in.mjs` and `style.css`, and PenguinHarness's `icon.svg`.
