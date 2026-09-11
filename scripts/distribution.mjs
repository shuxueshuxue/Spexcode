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
import { buildProjection } from './sync-init-plugins.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
// While the line is a prerelease, the verbs these packages use exist only under npm's `next` tag.
const tag = version.includes('-') ? '@next' : ''
const spex = `npx -y -p spexcode${tag} spex`
const spexWithPage = `npx -y -p spexcode${tag} -p @spexcode/spec-dashboard${tag} spex`
// A penguin plugin's version is the date of its content, by that host's convention; bump it when the skill changes.
const PENGUIN_VERSION = '2026.09.10.1'

const preset = buildProjection().get(join('skills', 'atlas', 'spec.md'))
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
- A diagram draws one node of the repository's spec tree, the \`.spec/\` folder. If the repository has none, write
  only what the drawing needs: \`.spec/<project>/spec.md\` describing the project, and one folder beside it per part
  worth a box, each with its own \`spec.md\` — a \`title:\` and a \`code:\` line naming the file it is about in the
  frontmatter, a sentence or two below. That is the whole setup: no \`spex init\`, no hooks, no agent configuration.
  \`spex guide spec\` has the full file format if you need more.
- \`spex guide diagram\` is the manual for the diagram format and the loop; read it once.

`
const page = `

## Hand over the page

\`${spexWithPage} graph --public --html spexcode-atlas.html\` writes the whole tree — every body and
every picture — as one self-contained page that opens in any browser, straight from disk. Offer it with the report;
it is a product of the tree, not part of it, so leave it uncommitted.
`
const skill = (heading, extra = '') => `${heading}\n\n${bootstrap}${extra}${campaign.trimStart().trimEnd()}${page}`

const zcodeWorkflow = `## In ZCode: the whole repository as one dynamic workflow

When the job is a whole repository — read it into a spec tree, draw its pictures, hand over a page to browse
(提取 .spec、画架构图、做成可浏览网页) — do not work through it turn by turn: run it as one dynamic workflow.
\`\${ZCODE_SKILL_DIR}/atlas.dwf.ts\` is that workflow, already written and checked by the workflow compiler.

1. Read the script. Set \`LANGUAGE\` to the language the user is speaking and rewrite each \`phase("...")\` name into
   that language. Change nothing else.
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

`
const zcodeTrigger = 'Use when the user wants the atlas of a repository or its spec tree — read the codebase into a SpexCode spec tree, draw its architecture diagrams and hand over a browsable page (提取 .spec、画架构图、做成可浏览网页), draw the atlas, 画规格图, give node X a diagram, diagram this subtree. For a whole repository it runs one dynamic workflow; for a node or subtree it draws with spex diagram scaffold and check until each passes.'

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
const gugu = 'distribution/gugu/spexcode-atlas'
const penguin = 'distribution/penguin/use-spexcode'
const focus = readFileSync(join(root, 'packages/archify/browser.mjs'), 'utf8')
  .replace(/^export function /gm, 'function ')
  + '\nglobalThis.SpexCodeAtlasFocus = { scopeIds, focusDiagram }\n'
const genericSkill = skill(title)
const files = new Map([
  [`${claudeCode}/.claude-plugin/plugin.json`, json({
    name: 'atlas', displayName: 'SpexCode Atlas', version, description, author, homepage, repository, license: 'MIT',
    keywords: ['spec', 'architecture', 'diagram', 'spexcode'],
  })],
  [`${claudeCode}/skills/atlas/SKILL.md`, skillFile('atlas', trigger, genericSkill)],
  [`${zcode}/.zcode-plugin/plugin.json`, json({ name: 'atlas', version, description, author, homepage, repository, license: 'MIT', skills: 'skills' })],
  [`${zcode}/skills/atlas/SKILL.md`, skillFile('atlas', zcodeTrigger, skill(title, zcodeWorkflow))],
  [`${gugu}/manifest.json`, json({
    id: 'spexcode-atlas',
    name: 'SpexCode Atlas',
    description: 'The workspace\'s spec tree with an architecture diagram above each node that has one, drawn in the tab; one button starts an agent that extracts the tree and draws it.',
    author: 'SpexCode',
    categories: ['architecture'],
    // gugu versions are plain x.y.z, so a prerelease ships under its release number.
    version: version.replace(/-.*$/, ''),
    apiVersion: 1,
    entry: 'index.html',
    permissions: { capabilities: ['workspace:read', 'agents:control'] },
    contributes: { tabs: [{ name: 'atlas', title: 'Spec Atlas', toolbar: [{ id: 'draw', title: 'Draw the atlas' }, { id: 'refresh', title: 'Refresh' }] }] },
  })],
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
  const stale = [...files].filter(([path, content]) => !existsSync(join(root, path)) || readFileSync(join(root, path), 'utf8') !== content)
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
