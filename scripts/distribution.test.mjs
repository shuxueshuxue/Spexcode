// [[distribution]]: what each host package claims about itself, checked here so a stale or broken package
// cannot reach main. Freshness of the generated files is `npm run lint`'s `--check`; this proves behaviour.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import vm from 'node:vm'
import * as archify from '../packages/archify/index.mjs'
import * as bundled from '../distribution/gugu/spexcode/archify.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function diagramFiles(dir, found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) diagramFiles(path, found)
    else if (entry.name === 'diagram.json') found.push(path)
  }
  return found
}

test('the gugu tab draws every diagram byte for byte as archify does, with no Node built-in in reach', async () => {
  const examples = readdirSync(join(root, 'packages/archify/examples')).map((name) => join(root, 'packages/archify/examples', name))
  const irs = [...examples, ...diagramFiles(join(root, '.spec'))]
  assert.ok(irs.length >= 10)
  const kinds = new Set()
  for (const file of irs) {
    const ir = JSON.parse(readFileSync(file, 'utf8'))
    kinds.add(ir.diagram_type)
    const expected = await archify.renderDiagram(ir.diagram_type, structuredClone(ir), { evidence: false })
    const actual = await bundled.renderDiagram(ir.diagram_type, structuredClone(ir), { evidence: false })
    assert.equal(actual.svg, expected.svg, file)
  }
  assert.deepEqual([...kinds].sort(), [...archify.DIAGRAM_TYPES].sort(), 'every diagram type is exercised')
})

test('the bundle loads and draws where Node\'s globals do not exist', () => {
  // A browser has no process, Buffer or require; the parity test above runs inside Node, where all three exist.
  const probe = `
    const ir = ${JSON.stringify(readFileSync(join(root, 'packages/archify/examples/web-app.architecture.json'), 'utf8'))}
    for (const name of ['process', 'Buffer', 'require', 'module', 'exports', '__dirname', '__filename', 'global']) delete globalThis[name]
    const { renderDiagram } = await import(${JSON.stringify(pathToFileURL(join(root, 'distribution/gugu/spexcode/archify.mjs')).href)})
    const parts = await renderDiagram('architecture', JSON.parse(ir), { evidence: false })
    console.log(parts.svg.includes('<svg ') && parts.svg.includes('data-node-id') ? 'drawn' : 'no svg')`
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8' })
  assert.equal(run.stderr, '')
  assert.equal(run.stdout.trim(), 'drawn')
})

test('the gugu App\'s program runs the spex its version pins, in the working copy gugu stamps on the call, and reads only .spec', async () => {
  // The tab cannot run git, so its two reads go through tools.js. This runs those tools against a working copy and
  // an npx that records its argv and answers as `spex graph --json` does: the argv is the pinned one, the payload
  // reaches the tab trimmed to what it draws, and a path outside `.spec/` is refused rather than read.
  const { SPEX } = await import(pathToFileURL(join(root, 'distribution/gugu/spexcode/spex-command.js')).href)
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  assert.deepEqual(SPEX.args.slice(-2), ['-p', `spexcode@${version}`])
  const work = mkdtempSync(join(tmpdir(), 'gugu-app-'))
  const bin = mkdtempSync(join(tmpdir(), 'fake-npx-'))
  const before = process.env.PATH
  try {
    mkdirSync(join(work, '.spec/app/api'), { recursive: true })
    writeFileSync(join(work, '.spec/app/spec.md'), '---\ntitle: app\n---\n# app\n\nSee [[api]].\n')
    writeFileSync(join(work, '.spec/app/api/spec.md'), '---\ntitle: api\n---\nThe API.\n')
    writeFileSync(join(work, '.spec/app/api/diagram.json'), '{"diagram_type":"architecture"}')
    writeFileSync(join(work, 'secret.md'), 'not a spec')
    const graph = { identity: { title: 'app' }, sessions: [], nodes: [
      { id: 'app', parent: null, path: '.spec/app/spec.md', title: 'app', desc: 'root', code: [], status: 'merged', drift: 0, driftFiles: [], version: 3, overlays: [], relatedEntries: [] },
      { id: 'api', parent: 'app', path: '.spec/app/api/spec.md', title: 'api', desc: '', code: ['src/api.ts'], status: 'drift', drift: 2, driftFiles: [{ file: 'src/api.ts', behind: 2 }], version: 1, overlays: [], relatedEntries: [] },
    ] }
    // npx: record how it was called and from where, drop its own four options as npx does, run the rest.
    writeFileSync(join(bin, 'npx'), `#!/bin/sh\necho "$*" > "${join(bin, 'argv')}"\npwd > "${join(bin, 'npx-cwd')}"\nshift 4\nexec "$@"\n`)
    // spex: answer as `spex graph --json` does, and record where it ran.
    writeFileSync(join(bin, 'spex'), `#!/bin/sh\npwd > "${join(bin, 'spex-cwd')}"\ncat <<'JSON'\n${JSON.stringify(graph)}\nJSON\n`)
    chmodSync(join(bin, 'npx'), 0o755)
    chmodSync(join(bin, 'spex'), 0o755)
    process.env.PATH = `${bin}:${before}`
    const tools = await import(pathToFileURL(join(root, 'distribution/gugu/spexcode/tools.js')).href)
    assert.deepEqual(Object.keys(tools).sort(), ['graph', 'node', 'share'])
    for (const tool of [tools.graph, tools.node]) assert.deepEqual(tool._meta.ui.visibility, ['app'], 'the tab\'s reads are not agent tools')
    assert.deepEqual(tools.share._meta.ui.visibility, ['model'], 'sharing is an agent\'s tool, never the tab\'s')
    // The working copy is gugu's stamp (`workspaceRoot`), never an argument: a tab beside a task on another computer
    // knows no path there, and a page must not point the program at a folder of its choosing.
    const stamp = { workspaceRoot: work }
    const tree = await tools.graph.run({ root: '/elsewhere' }, stamp)
    const helper = join(root, 'distribution/gugu/spexcode/spex-in.mjs')
    const argv = readFileSync(join(bin, 'argv'), 'utf8').trim()
    assert.equal(argv, [...SPEX.args, 'node', 'spex-in.mjs', 'graph', '--json'].join(' '))
    // On Windows the command line goes through a shell: it may hold constants only — no working copy, no absolute
    // path (the App's folder has a space in it), or a path with `&` in it runs as a command.
    assert.ok(!argv.includes(work) && !argv.split(' ').some((a) => isAbsolute(a)), argv)
    // npx runs from the App's folder — inside SpexCode's own repository npx takes the local `spexcode` package
    // for the one it was asked to fetch and finds no spex — and spex runs in the working copy.
    assert.equal(realpathSync(readFileSync(join(bin, 'npx-cwd'), 'utf8').trim()), realpathSync(dirname(helper)))
    assert.equal(realpathSync(readFileSync(join(bin, 'spex-cwd'), 'utf8').trim()), realpathSync(work))
    assert.equal(tree.title, 'app')
    assert.deepEqual(tree.nodes.map((n) => [n.id, n.status, n.diagram]), [['app', 'merged', false], ['api', 'drift', true]])
    assert.equal('overlays' in tree.nodes[0], false, 'the tab gets only what it draws')
    const api = await tools.node.run({ path: '.spec/app/api/spec.md' }, stamp)
    assert.equal(api.body, 'The API.\n')
    assert.equal(JSON.parse(api.diagram).diagram_type, 'architecture')
    await assert.rejects(tools.node.run({ path: 'secret.md' }, stamp), /is not a spec\.md under/)
    await assert.rejects(tools.node.run({ path: '.spec/../secret.md' }, stamp), /is not a spec\.md under/)
    await assert.rejects(tools.graph.run({}, {}), /no working copy/)
    await assert.rejects(tools.graph.run({}, { workspaceRoot: 'relative/path' }), /no working copy/)
    // share: one file per project in the chat, its next version when it is there already, readable with no program.
    const chatFiles = []
    const calls = []
    globalThis.gugu = { files: {
      list: async (place) => { calls.push(['list', place]); return chatFiles },
      upload: async (place, file) => { calls.push(['upload', place, file.name, file.type]); chatFiles.push({ id: 'f1', name: file.name, type: 'binary', version: 1, bytes: await file.text() }); return [chatFiles.at(-1)] },
      replace: async (entry, blob, options) => { calls.push(['replace', entry.id, options]); entry.version += 1; entry.bytes = await blob.text() },
    } }
    try {
      const first = await tools.share.run({ chat: 'c1' }, stamp)
      assert.deepEqual(first, { file: 'app.spexcode', newVersion: false, nodes: 2, bytes: chatFiles[0].bytes.length })
      assert.deepEqual(calls.slice(0, 2), [['list', { chat: 'c1', folder: '' }], ['upload', { chat: 'c1' }, 'app.spexcode', 'application/octet-stream']])
      const snapshot = JSON.parse(chatFiles[0].bytes)
      assert.equal(snapshot.schema, 'spexcode.gugu-snapshot/v1')
      assert.deepEqual(snapshot.nodes.map((n) => n.id), ['app', 'api'])
      assert.deepEqual(snapshot.documents.api, { body: 'The API.\n', diagram: '{"diagram_type":"architecture"}' })
      assert.equal(JSON.stringify(snapshot).includes(work), false, 'no path of the sharer\'s computer goes into the chat')
      const again = await tools.share.run({ chat: 'c1' }, stamp)
      assert.equal(again.newVersion, true)
      assert.deepEqual(calls.at(-1), ['replace', 'f1', { expectedVersion: 1 }])
      assert.equal(chatFiles.length, 1)
    } finally {
      delete globalThis.gugu
    }
  } finally {
    process.env.PATH = before
    rmSync(work, { recursive: true, force: true })
    rmSync(bin, { recursive: true, force: true })
  }
})

test('the ZCode workflow\'s lint gate runs as the command line it submits, and reads lint\'s report', () => {
  // world.run executes a fixed argv with no shell. This runs that exact argv, taken from the script, against an
  // npx that answers with a lint report — the one way to catch a command line that parses but never runs.
  const src = readFileSync(join(root, 'distribution/zcode/atlas/skills/atlas/atlas.dwf.ts'), 'utf8')
  const constant = (name) => eval(`(${new RegExp(`^const ${name} = ([^;]+);$`, 'm').exec(src)[1]})`)
  const SPEX = constant('SPEX')
  const GATE = eval(src.slice(src.indexOf('const GATE = [') + 'const GATE = '.length, src.indexOf('].join("\\n");') + 1)).join('\n')
  const call = /world\.run\("node", (\[[^\]]*\])/.exec(src)
  assert.ok(call, 'the gate runs through node')
  const argv = new Function('SPEX', 'GATE', `return ${call[1]}`)(SPEX, GATE)
  const bin = mkdtempSync(join(tmpdir(), 'fake-npx-'))
  try {
    const report = { sourceFiles: ['a.py', 'b.py', 'c.py', 'd.py'], findings: [
      { level: 'error', rule: 'mention', spec: 'root', msg: 'names no node' },
      { level: 'warn', rule: 'coverage', file: 'd.py', msg: 'no spec governs d.py' },
    ] }
    writeFileSync(join(bin, 'npx'), `#!/bin/sh\n[ "$1" = "-y" ] || { echo "npx got: $*" >&2; exit 3; }\ncat <<'JSON'\n${JSON.stringify(report)}\nJSON\n`)
    chmodSync(join(bin, 'npx'), 0o755)
    const run = spawnSync('node', argv, { encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } })
    assert.equal(run.status, 0, run.stderr)
    const gate = JSON.parse(run.stdout)
    assert.deepEqual({ governed: gate.governed, coverage: gate.coverage, errorCount: gate.errorCount, uncovered: gate.uncovered }, { governed: 4, coverage: 75, errorCount: 1, uncovered: ['d.py'] })
    assert.equal(gate.failed, undefined)
  } finally {
    rmSync(bin, { recursive: true, force: true })
  }
})

test('the gugu page\'s classic scripts share one global scope without colliding', () => {
  // A classic <script> puts its top-level declarations in the GLOBAL lexical scope, so every script on the page
  // shares one namespace: a helper that leaks `function buildTree` makes the page's own `const { buildTree } = …`
  // a redeclaration, and the browser refuses to parse the page's script at all. Evaluating each file on its own
  // (as the helper above and gugu's shipped-example harness both do) cannot see that — the collision only exists
  // between files — so this reads the scripts in the order the page loads them and parses them as one scope.
  const dir = join(root, 'distribution/gugu/spexcode')
  const html = readFileSync(join(dir, 'index.html'), 'utf8')
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(([, src]) => src)
  assert.ok(scripts.length >= 2, 'the page should load several classic scripts')
  const source = scripts.map((src) => readFileSync(join(dir, src), 'utf8')).join('\n;\n')
  // new Function parses without running: a duplicate declaration is a SyntaxError here exactly as in the browser.
  assert.doesNotThrow(() => new Function(source), SyntaxError)
})

test('every package names only files that exist, and the ZCode skill points at the workflow it ships', () => {
  const zcodeSkill = readFileSync(join(root, 'distribution/zcode/atlas/skills/atlas/SKILL.md'), 'utf8')
  // npx reads npm's config from the CWD, and the CWD is the repository being drawn — a monorepo that pins an
  // internal registry in its own `.npmrc` sends the skill's FIRST command to a host that has never heard of
  // spexcode (measured: ECONNRESET against a company registry). Every package names the public registry for
  // its own fetch, and says nothing about how the repository installs its own dependencies.
  const shippedSkills = {
    'claude-code': 'distribution/claude-code/atlas/skills/atlas/SKILL.md',
    codex: 'distribution/codex/plugins/atlas/skills/atlas/SKILL.md',
    penguin: 'distribution/penguin/use-spexcode/skills/atlas/SKILL.md',
    gugu: 'distribution/gugu/spexcode/skills/atlas/SKILL.md',
    zcode: 'distribution/zcode/atlas/skills/atlas/SKILL.md',
  }
  for (const [name, path] of Object.entries(shippedSkills)) {
    const body = readFileSync(join(root, path), 'utf8')
    for (const line of body.split('\n').filter((l) => l.includes('npx -y'))) {
      assert.match(line, /--registry=https:\/\/registry\.npmjs\.org/, `${name}: ${line.trim().slice(0, 80)}`)
    }
    assert.match(body, /LANGUAGE THE PERSON ASKED IN/, `${name} says which language the tree is written in`)
  }

  for (const [name, path] of Object.entries({
    'claude-code': 'distribution/claude-code/atlas',
    codex: 'distribution/codex/plugins/atlas',
  })) {
    assert.equal(existsSync(join(root, path, 'commands/atlas.md')), false, name + ' has no duplicate command surface')
    assert.equal(existsSync(join(root, path, 'prompts/atlas.md')), false, name + ' has no duplicate prompt surface')
  }

  // The generator never touches `atlas.dwf.ts` — it is hand-written — so it drifted: while every SKILL.md
  // moved to the public registry and off the `@next` pin, the workflow script kept `-p spexcode@next` with no
  // registry, in the very arrays ZCode executes. An assertion that only reads the generated files cannot see
  // that, which is why this one reads every shipped file that spells the command.
  const dwf = readFileSync(join(root, 'distribution/zcode/atlas/skills/atlas/atlas.dwf.ts'), 'utf8')
  for (const line of dwf.split('\n').filter((l) => l.includes('npx -y') || l.includes('"-y"'))) {
    assert.match(line, /--registry=https:\/\/registry\.npmjs\.org/, `atlas.dwf.ts: ${line.trim().slice(0, 80)}`)
  }
  assert.doesNotMatch(dwf, /spexcode@next|spec-dashboard@next/, 'the workflow script pins no prerelease')
  // ZCode's authoring guide pins that a workflow script names no tool profile: `agent()`'s second argument is
  // the persona's instructions, so a read-only role is stated in words.
  assert.doesNotMatch(dwf, /tools:\s*"readonly"|ToolProfile/, 'the workflow script names no tool profile')
  assert.match(zcodeSkill, /\$\{ZCODE_SKILL_DIR\}\/atlas\.dwf\.ts/)
  assert.ok(existsSync(join(root, 'distribution/zcode/atlas/skills/atlas/atlas.dwf.ts')))
  const manifest = JSON.parse(readFileSync(join(root, 'distribution/gugu/spexcode/manifest.json'), 'utf8'))
  assert.ok(existsSync(join(root, 'distribution/gugu/spexcode', manifest.entry)))
  // The market (gugu-apps) lists a version only when the App's CHANGELOG has a section for it.
  assert.match(readFileSync(join(root, 'distribution/gugu/spexcode/CHANGELOG.md'), 'utf8'), new RegExp(`^## ${manifest.version.replace(/\./g, '\\.')}$`, 'm'))
  for (const [, ref] of readFileSync(join(root, 'distribution/gugu/spexcode/README.md'), 'utf8').matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) assert.ok(existsSync(join(root, 'distribution/gugu/spexcode', ref)), ref)
  // The market gives agents one line per App, `- <name> (<id>): <first sentence>`, cut at 120 characters (gugu-apps'
  // GUGU_APPS_LINE_MAX_CHARS; it refuses a version whose line is longer).
  const first = /^[\s\S]*?(?:\.(?=\s|$)|。)/.exec(manifest.description)?.[0] ?? manifest.description
  assert.ok([...`- ${manifest.name} (${manifest.id}): ${first}`].length <= 120, first)
  // gugu refuses a manifest whose description runs over 280 characters, in any language.
  for (const text of [manifest.description, ...Object.values(manifest.localized ?? {}).map((l) => l.description)]) assert.ok(text.length <= 280, `${text.length}: ${text}`)
  for (const tab of manifest.contributes.tabs) assert.ok(existsSync(join(root, 'distribution/gugu/spexcode', tab.entry)), tab.entry)
  for (const server of manifest.contributes.mcpServers) assert.ok(existsSync(join(root, 'distribution/gugu/spexcode', server.tools)), server.tools)
  assert.ok(existsSync(join(root, 'distribution/gugu/spexcode', manifest.icon)))
  for (const name of ['atlas', 'spexcode']) assert.ok(existsSync(join(root, 'distribution/gugu/spexcode', manifest.contributes.skills, name, 'SKILL.md')), name)
  // The gugu skill tells an agent to run the same spex the tab's program runs.
  const guguSkill = readFileSync(join(root, 'distribution/gugu/spexcode/skills/spexcode/SKILL.md'), 'utf8')
  assert.ok(guguSkill.includes(`-p spexcode@${JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version} spex`))
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  const html = readFileSync(join(root, 'distribution/gugu/spexcode', manifest.entry), 'utf8')
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(existsSync(join(root, 'distribution/gugu/spexcode', ref)), ref)
  // Codex reads the same shape as Claude Code under its own dotted directory; its manifest points at the folder.
  // Codex installs a plugin out of a MARKETPLACE, never a bare plugin directory: the package is a marketplace
  // root whose manifest names its plugins by relative path, so an adopter runs `codex plugin marketplace add
  // <dir>` then `codex plugin add atlas@spexcode`. Pointed at the plugin itself, Codex refuses with
  // "marketplace root does not contain a supported manifest".
  const market = JSON.parse(readFileSync(join(root, 'distribution/.agents/plugins/marketplace.json'), 'utf8'))
  assert.equal(market.name, 'spexcode')
  const entry = market.plugins.find((p) => p.name === 'atlas')
  assert.ok(entry, 'the marketplace lists the atlas plugin')
  assert.equal(entry.source.source, 'local')
  // ON_INSTALL | ON_USE are the only values Codex parses; anything else fails the manifest outright.
  assert.ok(['ON_INSTALL', 'ON_USE'].includes(entry.policy.authentication), entry.policy.authentication)
  // Claude Code reads its own manifest from the SAME root, under its own dotted path — one directory an
  // adopter adds, two hosts that each find what they look for. A plugin manifest that validates is not a
  // plugin that installs: `claude plugin validate` passes on the bare plugin directory that
  // `claude plugin marketplace add` then rejects, so the root manifest is what the gate holds.
  const ccMarket = JSON.parse(readFileSync(join(root, 'distribution/.claude-plugin/marketplace.json'), 'utf8'))
  assert.equal(ccMarket.name, 'spexcode')
  const ccEntry = ccMarket.plugins.find((p) => p.name === 'atlas')
  assert.ok(ccEntry, 'the Claude Code marketplace lists the atlas plugin')
  assert.ok(existsSync(join(root, 'distribution', ccEntry.source, '.claude-plugin/plugin.json')), ccEntry.source)
  const codexPlugin = join(root, 'distribution', entry.source.path)
  assert.ok(existsSync(codexPlugin), entry.source.path)
  const codex = JSON.parse(readFileSync(join(codexPlugin, '.codex-plugin/plugin.json'), 'utf8'))
  assert.ok(existsSync(join(codexPlugin, codex.skills)), codex.skills)
  assert.ok(existsSync(join(codexPlugin, 'skills/atlas/SKILL.md')))
  assert.equal(existsSync(join(root, 'distribution/codex/atlas')), false, 'the bare-plugin layout Codex cannot install is gone')
  // The mirror is what adopters add, and it is kept equal to this directory by CD rather than by hand —
  // triggered only when this directory changes, so an unrelated push never republishes the packages.
  const cd = readFileSync(join(root, '.github/workflows/distribution-sync.yml'), 'utf8')
  assert.match(cd, /paths:\n\s+- 'distribution\/\*\*'/)
  assert.match(cd, /node scripts\/distribution\.mjs --check/, 'the mirror carries generator output, never a hand-edit')
  for (const pkg of ['distribution/penguin/use-spexcode']) {
    const listed = JSON.parse(readFileSync(join(root, pkg, 'package.json'), 'utf8')).files
    for (const file of listed) assert.ok(existsSync(join(root, pkg, file)), `${pkg}/${file}`)
  }
})

// The gugu App's page, run in a bare stand-in for the DOM with a stand-in bridge whose program answers are held and
// let go by the test — no clock. Two things a reading of the code does not settle: reads go out one at a time, and a
// read still out when the tab moves to another task is dropped rather than drawn there.
function guguPage({ file = null } = {}) {
  const byId = new Map()
  class El {
    constructor(tag = 'div', id = null) { Object.assign(this, { tagName: tag, id, children: [], hidden: false, className: '', dataset: {}, style: {}, value: '', placeholder: '', scrollTop: 0, attrs: {} }); this._text = '' }
    get textContent() { return this._text + this.children.map((c) => c.textContent).join('') }
    set textContent(v) { this._text = String(v); this.children = [] }
    set innerHTML(v) { this._text = String(v); this.children = [] }
    append(...nodes) { this.children.push(...nodes) }
    replaceChildren(...nodes) { this.children = nodes; this._text = '' }
    setAttribute(k, v) { this.attrs[k] = String(v) }
    getAttribute(k) { return this.attrs[k] ?? null }
    addEventListener() {}
    querySelector() { return null }
    focus() {}
    walk() { return [this, ...this.children.flatMap((c) => c.walk())] }
  }
  const document = {
    getElementById: (id) => { if (!byId.has(id)) byId.set(id, new El('div', id)); return byId.get(id) },
    createElement: (tag) => new El(tag),
    addEventListener() {},
    documentElement: { lang: '', style: {} },
    acts: [new El('div'), new El('div')],
    querySelectorAll: (selector) => (selector === '.act' ? document.acts : []),
  }
  const asks = []
  const reported = []
  const hooks = {}
  // gugu stamps each call with the working copy of the task the tab sits beside AT THAT MOMENT (`workspaceRoot`).
  let stamped = file ? null : '/A'
  const tree = (root) => ({ title: root, spex: '0', nodes: [{ id: `${root}-top`, parent: null, path: `.spec/${root}-top/spec.md`, title: `${root} top`, desc: '', code: [], status: 'merged', drift: 0, driftFiles: [], version: 1, diagram: false }] })
  const gugu = {
    reportError: async (message) => void reported.push(message),
    callProgram: (tool, args, root = stamped) => new Promise((resolve) => asks.push({ tool, args, root, answer: () => {
      const name = root.slice(1)
      if (tool === 'graph') return resolve({ content: [{ type: 'text', text: JSON.stringify(tree(name)) }] })
      // The program refuses a spec that is not under the working copy it is handed, as tools.js does.
      resolve(args.path.startsWith(`.spec/${name}-`) ? { content: [{ type: 'text', text: JSON.stringify({ body: 'body', diagram: null }) }] }
        : { isError: true, content: [{ type: 'text', text: `ENOENT: ${root}/${args.path}` }] })
    } })),
    getContext: async () => (file
      ? { locale: 'en', themeMode: 'light', capabilities: ['files:read'], chat: { id: 'c1' }, file }
      : { locale: 'en', themeMode: 'light', capabilities: ['files:read', 'agents:read', 'agents:control', 'agents:tools'], session: { id: 'sA', root: '/A', projectId: 'pA' } }),
    onContextChanged: (fn) => { hooks.context = (next) => { stamped = next.session?.root ?? stamped; fn(next) } },
    onCommand: (fn) => { hooks.command = fn },
    onAgentsChanged() {},
    listAgents: async () => [],
    files: {
      onChanged: () => () => {},
      open: async (entry) => ({ entry: { ...entry, createdBy: { name: 'Kip' }, updatedAt: '2026-10-19T01:00:00Z' }, blob: async () => new Blob([JSON.stringify(entry.snapshot)]) }),
    },
    markdown: async () => ({ render: (element, text) => { element.textContent = text } }),
  }
  const context = vm.createContext({ document, setTimeout, clearTimeout, console, SpexCodeAtlasFocus: { focusDiagram() {}, scopeIds: (svg) => svg }, SpexCodeAtlasPrompt: { ATLAS_PROMPT: 'draw' } })
  context.window = context
  context.gugu = gugu
  const source = readFileSync(join(root, 'distribution/gugu/spexcode/app.js'), 'utf8')
    .replace("import('./archify.mjs')", "Promise.resolve({ renderDiagram: async () => ({ svg: '' }) })")
  vm.runInContext(source, context)
  const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r)) }
  const open = () => asks.filter((a) => !a.done)
  const answer = async (tool) => { const a = open().find((x) => x.tool === tool); a.done = true; a.answer(); await settle() }
  const drawn = () => document.getElementById('tree').walk().filter((e) => e.className === 'label').map((e) => e.textContent)
  const graphs = () => asks.filter((a) => a.tool === 'graph')
  return { asks, reported, hooks, settle, open, answer, drawn, graphs, document, error: () => document.getElementById('error') }
}

test('the gugu App reads the tree one read at a time, and once more for what changed meanwhile', async () => {
  const p = guguPage()
  await p.settle()
  assert.equal(p.graphs().length, 1, 'the first read is out')
  for (let i = 0; i < 5; i += 1) { p.hooks.command('refresh'); await p.settle() }
  assert.equal(p.graphs().length, 1, 'five refreshes during a read start no second read beside it')
  await p.answer('graph')
  await p.answer('node')
  assert.equal(p.graphs().length, 2, 'one more read follows for the refreshes that came meanwhile')
  while (p.open().length) await p.answer(p.open()[0].tool)
  assert.equal(p.graphs().length, 2)
  assert.deepEqual(p.reported, [])
})

test('the gugu App drops a read that comes back after the tab moved to another task', async () => {
  const p = guguPage()
  await p.settle()
  p.hooks.context({ session: { id: 'sB', root: '/B', projectId: 'pB' } })
  await p.settle()
  await p.answer('graph') // task A's tree, after the tab moved to B
  assert.deepEqual(p.drawn(), [], 'A\'s tree is not drawn under B')
  assert.ok(!p.asks.some((a) => a.tool === 'node' && a.root === '/B' && a.args.path.startsWith('.spec/A-')), 'no node of A is asked under B')
  while (p.open().length) await p.answer(p.open()[0].tool)
  assert.deepEqual(p.graphs().map((a) => a.root), ['/A', '/B'])
  assert.deepEqual(p.drawn(), ['B top'])
  assert.equal(p.error().hidden, true)
  assert.deepEqual(p.reported, [])
})

test('the gugu App opened for a shared snapshot draws that file, with no program and no work to hand on', async () => {
  const snapshot = { schema: 'spexcode.gugu-snapshot/v1', title: 'app', nodes: [
    { id: 'app', parent: null, path: '.spec/app/spec.md', title: 'app top', desc: '', code: [], status: 'drift', drift: 1, driftFiles: [], version: 1, diagram: false },
  ], documents: { app: { body: 'from the file', diagram: null } } }
  const p = guguPage({ file: { id: 'f1', name: 'app.spexcode', snapshot } })
  await p.settle()
  assert.deepEqual(p.asks, [], 'nothing asks the program: a phone has none')
  assert.deepEqual(p.drawn(), ['app top'])
  assert.equal(p.document.getElementById('body').textContent, 'from the file')
  assert.match(p.document.getElementById('tree-note').textContent, /1 nodes · 1 drifted · Shared by Kip/)
  assert.deepEqual(p.document.acts.map((a) => a.hidden), [true, true], 'cite and start need a task: hidden')
  assert.deepEqual(p.reported, [])
})
