# distribution

SpexCode's atlas — the skill that reads a repository into a spec tree, draws its architecture diagrams and hands
over one browsable page — packaged in the format of each host that installs agent add-ons. Nothing here is part of
SpexCode itself: SpexCode's own skills and hooks live in `.spec/spexcode/.plugins/`, and these folders are what other
products load. Every package runs SpexCode through `npx`, so a user installs nothing and configures nothing.

| Folder | Host | What the host gets | Load it without a store |
| --- | --- | --- | --- |
| `claude-code/atlas` | Claude Code | a plugin with the `atlas` skill | `claude --plugin-dir distribution/claude-code/atlas` |
| `zcode/atlas` | ZCode | a plugin with the `atlas` skill, plus `atlas.dwf.ts`: the whole job as one dynamic workflow | list the folder in `plugins.dirs` |
| `gugu/spexcode-atlas` | gugu | a tab extension: the spec tree with each node's diagram drawn in the tab, and a button that starts an agent on the atlas | Settings → Extensions → Install, pick the folder |
| `penguin/use-spexcode` | PenguinHarness | a library plugin with the `atlas` skill | copy `skills/atlas` into an agent's `agent_state/skills/` |

No folder is a marketplace. Each package is what gets submitted to that host's own store or library.

**Generated or written by hand.** `npm run build:distribution` writes every manifest, every `SKILL.md`, the gugu tab's
prompt and its copies of archify (`archify.js`, `focus.js`, `diagram.css`) from their sources: the atlas preset in
`.spec/spexcode/.plugins/skills/atlas/`, the root version, and `packages/archify`. `npm run lint` fails while any of
them is stale. The rest was written by hand and the generator never touches it: `zcode/atlas/skills/atlas/atlas.dwf.ts`,
the gugu tab's `index.html`, `app.js`, `atlas-model.js` and `style.css`, and PenguinHarness's `icon.svg`.
