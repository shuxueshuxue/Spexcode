#!/usr/bin/env node
// Builds distribution/ — SpexCode's atlas in the package format of each host that installs agent add-ons
// ([[distribution]]). The atlas skill preset that `spex init` seeds is the one source of the skill text; this
// writes what each host needs around it, and nothing asks the user's machine to install or configure anything.
// Files a person wrote (the ZCode workflow, the gugu tab's page) sit beside these and are never touched here.
// `--check` fails when a generated file is stale: a preset edit, a version bump, an archify change.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { seedFiles } from './check-init-plugins.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
// While the line is a prerelease, the verbs these packages use exist only under npm's `next` tag.
const tag = version.includes('-') ? '@next' : ''
// `--registry` is not belt and braces. npx reads npm's config from the CWD, and the CWD here is the
// repository being drawn — a company monorepo routinely ships an `.npmrc` pinning an internal registry that
// has never heard of spexcode, so the very first command of this skill dies on `ECONNRESET` against a host
// the reader cannot reach. Naming the public registry for THIS fetch changes nothing about how the
// repository installs its own dependencies.
const REGISTRY = '--registry=https://registry.npmjs.org'
const spex = `npx -y ${REGISTRY} -p spexcode${tag} spex`
const spexWithPage = `npx -y ${REGISTRY} -p spexcode${tag} -p @spexcode/spec-dashboard${tag} spex`
// A penguin plugin's version is the date of its content, by that host's convention; bump it when the skill changes.
const PENGUIN_VERSION = '2026.09.10.1'
// The gugu App's version is its own: gugu's market lists the App by it, so a change to the App alone (its manifest, its
// page) ships as a new App version with no spexcode release. The spex it runs is still the root version
// (spex-command.js): when a release changes that, bump this too — the market refuses a version it already has.
const GUGU_APP_VERSION = '0.8.0'

const preset = seedFiles().get(join('skills', 'atlas', 'spec.md'))
if (!preset) throw new Error('.spec/spexcode/.plugins/skills/atlas/spec.md is missing')
const [, frontmatter, body] = preset.content.toString('utf8').match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/) ?? []
const trigger = frontmatter?.match(/^desc:\s*(.+)$/m)?.[1]?.trim()
if (!trigger || !body) throw new Error('the atlas preset needs a desc: line and a body')
const [, title, campaign] = body.trimStart().match(/^(# [^\n]+)\n([\s\S]*)$/) ?? []
if (!title) throw new Error('the atlas preset body must open with its # title')

const repository = 'https://github.com/shuxueshuxue/spexcode'
const homepage = 'https://spexcode.net'
const author = { name: 'SpexCode', url: homepage }
const description = 'Draw a spec atlas for a repository: choose the spec nodes worth a picture and draw each one\'s diagram with SpexCode, checked until it passes, then hand over the whole tree as one page.'

const bootstrap = `## Before you start

This skill draws with SpexCode's command line and needs nothing installed or configured on this machine.

- Run SpexCode through npx: \`${spex} <command>\` (Node 22 or newer). Wherever a step below says
  \`spex …\`, run it that way; a \`spex\` already on the PATH works the same.
- A diagram draws one node of the repository's spec tree, the \`.spec/\` folder. If the repository has none,
  \`spex init --pure --title <the project's name>\` plants one and stops there: \`.spec/spexcode.json\` and a root
  \`.spec/<name>/spec.md\`, no hooks, no agent configuration, nothing outside \`.spec/\`. Pass the project's REAL
  name — the checkout directory is often \`repo\` or \`tmp\`, and without a title both the root node and the page
  end up called that. Then rewrite that root to describe THIS project and add
  one folder beside it per part worth a box, each with its own \`spec.md\` — a \`title:\` and a \`code:\` line naming
  the file it is about in the frontmatter, a sentence or two below. \`spex guide spec\` has the full file format.
  Use \`--pure\`, not a bare \`spex init\`: a bare one adopts the repository into SpexCode's whole workflow, which is
  not what drawing a picture asks for.
- \`spex guide diagram\` is the manual for the diagram format and the loop; read it once.
- Write the tree in the LANGUAGE THE PERSON ASKED IN — node titles, \`desc\`, bodies, diagram labels and the
  report. The atlas is something a human reads, and an English tree handed to someone who asked in another
  language is a translation job you left them.

`
const page = `

## Hand over the page

\`${spexWithPage} graph --public --html spexcode-atlas.html\` writes the whole tree — every body and
every picture — as one self-contained page that opens in any browser, straight from disk. Offer it with the report;
it is a product of the tree, not part of it, so leave it uncommitted.

The page names the project after \`dashboard.title\` in \`.spec/spexcode.json\` and falls back to the directory it
was run in, so a scratch checkout called \`repo\` publishes a page titled that — wrong on the one artifact a person
is meant to read. \`--title\` at init sets it; on a tree that already exists, add \`dashboard.title\` to that file.

The page opens on the whole-tree overview, so a node's drawing is one click in. Say which node to open when you
hand it over, or the first thing the reader sees is a map rather than the picture they asked for.
`
const skill = (heading, extra = '') => `${heading}\n\n${bootstrap}${extra}${campaign.trimStart().trimEnd()}${page}`

const zcodeWorkflow = `## In ZCode: the whole repository as one dynamic workflow

When the job is a whole repository — read it into a spec tree, draw its pictures, hand over a page to browse
(提取 .spec、画架构图、做成可浏览网页) — do not work through it turn by turn: run it as one dynamic workflow.
\`\${ZCODE_SKILL_DIR}/atlas.dwf.ts\` is that workflow, already written and checked by the workflow compiler.

1. Read the script. Set \`LANGUAGE\` to the language the user is speaking, rewrite each \`phase("...")\` name into
   that language, and translate the \`SAID\` labels beside \`LANGUAGE\` into it — the report is assembled by the
   script, so those fixed words are the one part no prompt's language instruction reaches. Change nothing else.
2. Submit it with the \`CreateWorkflow\` tool as its \`script\` — not the legacy \`Workflow\` tool, not \`Agent\`.
3. The run surveys the repository and writes the spec for each part in parallel; gates on \`spex spec lint\` until it
   reports no errors and 90% coverage; chooses the nodes worth a picture, draws them in parallel and gates each on
   \`spex diagram check\`; has an independent reader check the top of the tree against the code; commits \`.spec/\`;
   and publishes the page as its \`atlas\` artifact, with a report beside it.
4. When it finishes, relay the report: coverage, which pictures pass, what was skipped and why, and every claim the
   reader found the code does not bear out. If a subagent escalates, answer it, or fix the script and resubmit with
   \`resume_from\` — the \`dynamic-workflows\` skill has both.

A repository that already has a \`.spec/\` tree keeps it: the workflow skips the survey and starts at the gate. For
one node or one subtree the steps below are enough; the workflow is for the whole job.

If this ZCode has no \`CreateWorkflow\` tool (dynamic workflows ship in newer builds), do the same job turn by turn
with the steps below: the setup above for a repository without \`.spec/\`, \`spex spec lint\` until it reports no
errors, then each picture worth drawing, checked until it passes. Tell the user this is the turn-by-turn path; a
ZCode build with dynamic workflows runs the same job in parallel.

`
const zcodeTrigger = 'Use when the user wants the atlas of a repository or its spec tree — read the codebase into a SpexCode spec tree, draw its architecture diagrams and hand over a browsable page (提取 .spec、画架构图、做成可浏览网页), draw the atlas, 画规格图, give node X a diagram, diagram this subtree. For a whole repository it runs one dynamic workflow (turn by turn where ZCode has no CreateWorkflow); for a node or subtree it draws with spex diagram scaffold and check until each passes.'

// The skill gugu's agents get beside the tab: how to work in a repository SpexCode governs, through the same pinned
// spex the tab's program runs. The governed repository's own instructions (spex init) still say the rest.
const guguSpex = `npx -y ${REGISTRY} -p spexcode@${version} spex`
const guguSpexTrigger = 'Use when working in a repository that has a .spec/ tree (SpexCode): find the spec that governs a file, keep specs and code in step, check drift with spex spec lint, read or file the repository\'s local issues. Also when a message names a spec node as [[node-id]].'
const guguSpexSkill = `# spexcode

This repository's intent is written as a spec tree: every folder under \`.spec/\` with a \`spec.md\` is a node, and a
node's \`code:\` line names the files or functions it governs. Run SpexCode as \`${guguSpex} <command>\` (Node 22 or
newer); a \`spex\` already on the PATH works the same. Inside SpexCode's own repository npx takes the local
\`spexcode\` package for the one it was asked to fetch and says \`spex: command not found\`: run the npx line from
any other directory with \`-c 'cd <this repository> && spex <command>'\`, or use a \`spex\` on the PATH.

- **A message that names \`[[node-id]]\`** is about that node: read it first, \`${guguSpex} spec search <id or topic>\`
  finds it, and its \`spec.md\` is the contract your change must keep.
- **Which spec governs a file:** \`spex spec owner <path>\`. The whole tree: \`spex graph\`.
- **Change code and spec together.** A change inside an anchored unit that leaves its spec alone is drift; with the
  repository's hooks installed the commit is refused. Update the spec in the same change, or, when the contract
  still holds, say so: \`git commit --trailer "Spec-OK: <node-id>"\`, or afterwards
  \`spex spec ack <node-id> --reason "<why the contract still holds>"\`.
- **Before you hand work back:** \`spex spec lint\` and fix what it reports.
- **No guard yet?** \`spex doctor\` says, under "git-hook floor", whether this repository's hooks are SpexCode's
  (a worktree's \`.git\` is a file and its hooks live in the common git dir, so read doctor, not \`.git/hooks\`).
  When they are missing, or present but not SpexCode's (another tool's hook in their place), tell the person this repository has not run \`spex init\`, so its spec guards are off. Do not
  run \`spex init\` yourself unless they tell you to: it writes the harnesses' own configuration, \`~/.codex/config.toml\`
  among it.
- **Issues** are markdown threads in \`.spec/.issues/\`: \`spex issue ls\`, \`spex issue show <id>\`,
  \`spex issue reply <id> …\`.
- **Share the tree with a group:** the \`spexcode__share\` tool (in \`catalog_list\` when it is not listed) takes the
  group's chat and puts a read-only snapshot of this working copy's tree — drift, bodies, diagrams — into its files,
  where the people there open it with SpexCode, phones included. Sharing again makes that file's next version. You
  must be a member of the group; when you are not, say so rather than looking for another way in.
- \`spex guide spec\` is the full file format; \`spex help <verb>\` the rest. Diagrams: the atlas skill.

The SpexCode tab beside this task shows the tree, each node's drift and its diagram, and follows \`.spec/\` as you write.
`

const json = (value) => `${JSON.stringify(value, null, 2)}\n`
const skillFile = (name, what, text) => `---\nname: ${name}\ndescription: ${JSON.stringify(what)}\n---\n\n${text}`
// PenguinHarness reads frontmatter as bare `key: value` lines and keeps quotes as text, as its own skills show by
// writing the description plain — so a line YAML would need quoting cannot be written for it at all.
const plainSkillFile = (name, what, text) => {
  if (/: |^[\s"'[{>|*&!%@`#-]/.test(what)) throw new Error(`a PenguinHarness skill description must be a plain YAML scalar: ${what}`)
  return `---\nname: ${name}\ndescription: ${what}\n---\n\n${text}`
}

// The gugu tab draws diagrams in the page with archify's own renderer. The renderers compute a few paths when they
// load and read no file when they draw, so path arithmetic is given to them and every other built-in throws if it
// is ever reached — a silent stub would turn a missing capability into a wrong picture.
const PATH_SHIM = `
const norm = (p) => { const abs = p.startsWith('/'); const out = []; for (const s of p.split('/')) { if (!s || s === '.') continue; if (s === '..') out.pop(); else out.push(s) } return (abs ? '/' : '') + out.join('/') || (abs ? '/' : '.') }
export const sep = '/'
export const isAbsolute = (p) => p.startsWith('/')
export const join = (...ps) => norm(ps.filter(Boolean).join('/'))
export const resolve = (...ps) => { let r = ''; for (const p of ps) r = p.startsWith('/') ? p : r + '/' + p; return norm(r.startsWith('/') ? r : '/' + r) }
export const dirname = (p) => { const n = norm(p); const i = n.lastIndexOf('/'); return i <= 0 ? (n.startsWith('/') ? '/' : '.') : n.slice(0, i) }
export const basename = (p, ext) => { const b = norm(p).split('/').pop() || ''; return ext && b.endsWith(ext) ? b.slice(0, -ext.length) : b }
export const extname = (p) => { const b = basename(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i) : '' }
export const relative = (from, to) => { const a = resolve(from).split('/').filter(Boolean), b = resolve(to).split('/').filter(Boolean); let i = 0; while (i < a.length && a[i] === b[i]) i++; return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/') }
export const normalize = norm
export default { sep, isAbsolute, join, resolve, dirname, basename, extname, relative, normalize }
`
const THROWING = (name) => `
const unavailable = (member) => () => { throw new Error(\`${name}\${member ? '.' + String(member) : ''} is not available where the atlas tab runs\`) }
export default new Proxy({}, { get: (_target, member) => unavailable(member) })
export const createHash = unavailable('createHash')
export const lookup = unavailable('lookup')
export const spawnSync = unavailable('spawnSync')
export const fileURLToPath = (url) => String(url).replace(/^file:\\/\\//, '')
export const pathToFileURL = (path) => new URL('file://' + path)
`
async function archifyBundle() {
  const result = await build({
    stdin: { contents: "export { renderDiagram, DIAGRAM_TYPES } from './packages/archify/index.mjs'", resolveDir: root, loader: 'js' },
    absWorkingDir: root,
    bundle: true,
    // gugu's shipped example harness parses every `.js` as a classic script. Archify has top-level awaits, so the
    // generated renderer remains an ESM `.mjs` asset and the classic tab page loads it with a local dynamic import.
    format: 'esm',
    platform: 'browser',
    minify: true,
    legalComments: 'none',
    // The renderers read `process.env` and `process.argv` when they load — the diagnostic format, whether this
    // file is a CLI entry. An empty environment and argv answer those exactly as an unset Node environment does,
    // and no CLI branch runs.
    banner: { js: "const process = { env: {}, argv: [], cwd: () => '/', pid: 0 };" },
    write: false,
    logLevel: 'silent',
    plugins: [{
      name: 'node-builtins',
      setup(b) {
        b.onResolve({ filter: /^node:/ }, (args) => ({ path: args.path, namespace: 'node-builtin' }))
        b.onLoad({ filter: /.*/, namespace: 'node-builtin' }, (args) => ({ contents: args.path === 'node:path' ? PATH_SHIM : THROWING(args.path), loader: 'js' }))
      },
    }],
  })
  return `/* eslint-disable */\n// Generated by scripts/distribution.mjs from packages/archify (MIT) — do not edit.\n${result.outputFiles[0].text}`
}

const claudeCode = 'distribution/claude-code/atlas'
const zcode = 'distribution/zcode/atlas'
const codex = 'distribution/codex/plugins/atlas'
// One directory serves both marketplaces: `distribution/` is the root an adopter adds, and each host finds its
// own manifest under its own dotted path inside it.
const market = 'distribution'
const gugu = 'distribution/gugu/spexcode'
const penguin = 'distribution/penguin/use-spexcode'
// A classic script's top-level declarations land in the page's ONE global scope, so a helper publishes its
// namespace inside a wrapper and leaks nothing else — otherwise the page's own `const { scopeIds } = …` is a
// redeclaration and the browser refuses to parse the page's script at all.
const focus = ';(() => {\n'
  + readFileSync(join(root, 'packages/archify/browser.mjs'), 'utf8').replace(/^export function /gm, 'function ')
  + '\nglobalThis.SpexCodeAtlasFocus = { scopeIds, focusDiagram }\n})()\n'
const genericSkill = skill(title)
const files = new Map([
  [`${claudeCode}/.claude-plugin/plugin.json`, json({
    name: 'atlas', displayName: 'SpexCode Atlas', version, description, author, homepage, repository, license: 'MIT',
    keywords: ['spec', 'architecture', 'diagram', 'spexcode'],
  })],
  [`${claudeCode}/skills/atlas/SKILL.md`, skillFile('atlas', trigger, genericSkill)],
  // Codex reads the same shape under its own dotted directory: a plugin.json beside a skills/ folder whose
  // SKILL.md carries `name` and `description`. Same skill text, different envelope.
  //
  // NEITHER host installs a bare plugin directory. Both resolve a plugin out of a MARKETPLACE — a root
  // carrying a manifest that lists its plugins by relative path — and point either one at the plugin itself
  // and it refuses ("marketplace root does not contain a supported manifest"; "Marketplace file not found").
  // A plugin manifest that VALIDATES is not a plugin that installs: `claude plugin validate` passes on the
  // bare directory that `claude plugin marketplace add` then rejects. So `distribution/` is the root, each
  // host reads its own manifest from its own dotted path inside it, and the adopter runs the two commands
  // that host documents.
  [`${market}/.claude-plugin/marketplace.json`, json({
    name: 'spexcode',
    description: 'SpexCode agent add-ons.',
    owner: { name: 'SpexCode', url: homepage },
    plugins: [{ name: 'atlas', source: './claude-code/atlas', description }],
  })],
  [`${market}/.agents/plugins/marketplace.json`, json({
    name: 'spexcode',
    interface: { displayName: 'SpexCode' },
    plugins: [{
      name: 'atlas',
      source: { source: 'local', path: './codex/plugins/atlas' },
      // ON_USE, not NONE: the enum Codex accepts is ON_INSTALL | ON_USE, and this plugin needs no auth at all,
      // so the later of the two is the honest one.
      policy: { installation: 'AVAILABLE', authentication: 'ON_USE', products: ['CODEX'] },
      category: 'Developer Tools',
    }],
  })],
  [`${codex}/.codex-plugin/plugin.json`, json({
    name: 'atlas', version, description, author, homepage, repository, license: 'MIT',
    keywords: ['spec', 'architecture', 'diagram', 'spexcode'], skills: './skills/',
  })],
  [`${codex}/skills/atlas/SKILL.md`, skillFile('atlas', trigger, genericSkill)],
  [`${zcode}/.zcode-plugin/plugin.json`, json({ name: 'atlas', version, description, author, homepage, repository, license: 'MIT', skills: 'skills' })],
  [`${zcode}/skills/atlas/SKILL.md`, skillFile('atlas', zcodeTrigger, skill(title, zcodeWorkflow))],
  [`${gugu}/manifest.json`, json({
    id: 'spexcode',
    name: 'SpexCode',
    // gugu App model v2: what people read is `subtitle` and the hand-written store/ beside this file (about, screenshots,
    // whats-new); what agents read is `contributes.instructions`, placed whole in every session's <gugu_apps>.
    defaultLocale: 'en',
    subtitle: 'Spec tree, drift and diagrams',
    localized: {
      'zh-CN': {
        name: 'SpexCode',
        subtitle: '规格树、代码漂移与架构图',
        examples: ['给这个仓库画一份规格图', '哪些规格和代码漂移了?'],
      },
    },
    examples: ['Draw the spec atlas of this repository', 'Which specs have drifted from the code?'],
    author: 'SpexCode',
    homepage,
    repository,
    license: 'MIT',
    categories: ['developer'],
    version: GUGU_APP_VERSION,
    // 24: gugu App model v2 (instructions, defaultLocale, store/); earlier clients keep the previous App version.
    apiVersion: 24,
    platforms: ['desktop', 'phone'],
    engines: { gugu: '>=0.3.1' },
    entry: 'index.html',
    icon: 'icon.png',
    // files:write puts an agent's shared snapshot into its group (tools.js `share`); gugu's files:write implies no read.
    permissions: { capabilities: ['files:read', 'files:write', 'agents:read', 'agents:control', 'agents:tools'] },
    contributes: {
      tabs: [
        { name: 'spec', title: 'SpexCode', entry: 'index.html', icon: 'icon.png', toolbar: [{ id: 'draw', title: 'Draw the atlas' }, { id: 'refresh', title: 'Refresh' }] },
        // A tab that claims files opens only for one: the snapshot a group was given, drawn by the same page.
        { name: 'snapshot', title: 'SpexCode', entry: 'index.html', icon: 'icon.png', opensFiles: { chat: ['.spexcode'] } },
      ],
      mcpServers: [{ tools: 'tools.js' }],
      skills: 'skills',
      instructions: 'Read skill spexcode in a repository with a .spec/ tree; skill atlas draws its diagrams. spexcode__share puts the tree into a group.',
    },
  })],
  // The tab's program runs the spex of THIS version, never whatever npm calls latest that day: what the install
  // sheet was consented to and what runs stay one thing.
  [`${gugu}/spex-command.js`, `// Generated by scripts/distribution.mjs from the root version — do not edit.\nexport const SPEX = ${JSON.stringify({ version, command: 'npx', args: ['-y', REGISTRY, '-p', `spexcode@${version}`] })}\n`],
  [`${gugu}/skills/atlas/SKILL.md`, skillFile('atlas', trigger, genericSkill)],
  [`${gugu}/skills/spexcode/SKILL.md`, skillFile('spexcode', guguSpexTrigger, guguSpexSkill)],
  [`${gugu}/icon.png`, readFileSync(join(root, 'docs/brand/favicon/favicon-128.png'))],
  [`${gugu}/prompt.js`, `// Generated by scripts/distribution.mjs from the atlas skill — do not edit.\nglobalThis.SpexCodeAtlasPrompt = { ATLAS_PROMPT: ${JSON.stringify(`Draw the SpexCode atlas of this repository, following these instructions.\n\n${genericSkill}`)} }\n`],
  [`${gugu}/focus.js`, `// Generated by scripts/distribution.mjs from packages/archify/browser.mjs — do not edit.\n${focus}`],
  [`${gugu}/diagram.css`, readFileSync(join(root, 'packages/archify/assets/diagram.css'), 'utf8')],
  [`${gugu}/archify.mjs`, await archifyBundle()],
  [`${penguin}/plugin.json`, json({
    description,
    description_zh: '为仓库绘制规格图集：挑出值得配图的规格节点，用 SpexCode 为每个节点画出架构图并检查到通过，最后把整棵规格树交付成一个可浏览的网页。',
    short_description: 'Spec atlas: architecture diagrams for a repository\'s spec tree.',
    short_description_zh: '规格图集：为仓库的规格树画架构图。',
    version: PENGUIN_VERSION,
    category: 'software-development',
    preinstall: false,
  })],
  [`${penguin}/package.json`, json({
    name: '@penguinharness/use-spexcode', version, description, license: 'MIT',
    repository: { type: 'git', url: `git+${repository}.git`, directory: penguin },
    files: ['plugin.json', 'icon.svg', 'skills'],
    publishConfig: { access: 'public' },
  })],
  [`${penguin}/skills/atlas/SKILL.md`, plainSkillFile('atlas', trigger, genericSkill)],
])

if (process.argv.includes('--check')) {
  const stale = [...files].filter(([path, content]) => !existsSync(join(root, path)) || !readFileSync(join(root, path)).equals(Buffer.from(content)))
  if (stale.length) {
    console.error(`distribution is stale (${stale.map(([path]) => path).join(', ')}) — run npm run build:distribution`)
    process.exit(1)
  }
} else {
  for (const [path, content] of files) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  console.log(`distribution: wrote ${files.size} files at ${version}`)
}
