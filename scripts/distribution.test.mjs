// [[distribution]]: what each host package claims about itself, checked here so a stale or broken package
// cannot reach main. Freshness of the generated files is `npm run lint`'s `--check`; this proves behaviour.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
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

test('the gugu App\'s program runs the spex its version pins, in the working copy it is handed, and reads only .spec', async () => {
  // The tab cannot run git, so its two reads go through tools.js. This runs those tools against a working copy and
  // an npx that records its argv and answers as `spex graph --json` does: the argv is the pinned one, the payload
  // reaches the tab trimmed to what it draws, and a path outside `.spec/` is refused rather than read.
  const { SPEX } = await import(pathToFileURL(join(root, 'distribution/gugu/spexcode/spex-command.js')).href)
  const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  assert.deepEqual(SPEX.args.slice(-2), [`spexcode@${version}`, 'spex'])
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
      { id: 'api', parent: 'app', path: '.spec/app/api/spec.md', title: 'api', desc: '', code: ['src/api.ts'], status: 'drift', drift: 2, driftFiles: ['src/api.ts'], version: 1, overlays: [], relatedEntries: [] },
    ] }
    writeFileSync(join(bin, 'npx'), `#!/bin/sh\necho "$*" > "${join(bin, 'argv')}"\npwd > "${join(bin, 'cwd')}"\ncat <<'JSON'\n${JSON.stringify(graph)}\nJSON\n`)
    chmodSync(join(bin, 'npx'), 0o755)
    process.env.PATH = `${bin}:${before}`
    const tools = await import(pathToFileURL(join(root, 'distribution/gugu/spexcode/tools.js')).href)
    assert.deepEqual(Object.keys(tools).sort(), ['graph', 'node'])
    for (const tool of Object.values(tools)) assert.deepEqual(tool._meta.ui.visibility, ['app'], 'the tab\'s reads are not agent tools')
    const tree = await tools.graph.run({ root: work })
    assert.equal(readFileSync(join(bin, 'argv'), 'utf8').trim(), [...SPEX.args, 'graph', '--json'].join(' '))
    assert.equal(realpathSync(readFileSync(join(bin, 'cwd'), 'utf8').trim()), realpathSync(work))
    assert.equal(tree.title, 'app')
    assert.deepEqual(tree.nodes.map((n) => [n.id, n.status, n.diagram]), [['app', 'merged', false], ['api', 'drift', true]])
    assert.equal('overlays' in tree.nodes[0], false, 'the tab gets only what it draws')
    const api = await tools.node.run({ root: work, path: '.spec/app/api/spec.md' })
    assert.equal(api.body, 'The API.\n')
    assert.equal(JSON.parse(api.diagram).diagram_type, 'architecture')
    await assert.rejects(tools.node.run({ root: work, path: 'secret.md' }), /is not a spec\.md under/)
    await assert.rejects(tools.node.run({ root: work, path: '.spec/../secret.md' }), /is not a spec\.md under/)
    await assert.rejects(tools.graph.run({ root: 'relative/path' }), /absolute path/)
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
    const skill = readFileSync(join(root, path, 'skills/atlas/SKILL.md'), 'utf8')
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
