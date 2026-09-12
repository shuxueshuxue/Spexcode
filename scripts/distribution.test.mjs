// [[distribution]]: what each host package claims about itself, checked here so a stale or broken package
// cannot reach main. Freshness of the generated files is `npm run lint`'s `--check`; this proves behaviour.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, existsSync, mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import * as archify from '../packages/archify/index.mjs'
import * as bundled from '../distribution/gugu/spexcode-atlas/archify.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const model = new Function(
  'globalThis',
  `${readFileSync(join(root, 'distribution/gugu/spexcode-atlas/atlas-model.js'), 'utf8')}\nreturn globalThis.SpexCodeAtlasModel`,
)(globalThis)
const { buildTree, parseSpec, renderMarkdown } = model

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
    const { renderDiagram } = await import(${JSON.stringify(pathToFileURL(join(root, 'distribution/gugu/spexcode-atlas/archify.mjs')).href)})
    const parts = await renderDiagram('architecture', JSON.parse(ir), { evidence: false })
    console.log(parts.svg.includes('<svg ') && parts.svg.includes('data-node-id') ? 'drawn' : 'no svg')`
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { encoding: 'utf8' })
  assert.equal(run.stderr, '')
  assert.equal(run.stdout.trim(), 'drawn')
})

test('the tab reads the folder tree as the spec tree, leaving SpexCode\'s own machinery out', () => {
  const spec = (title, extra = '') => `---\ntitle: ${title}\n${extra}---\n\n# ${title}\n\nbody of ${title}\n`
  const { byId, roots } = buildTree([
    { path: '.spec/app/spec.md', text: spec('app') },
    { path: '.spec/app/api/spec.md', text: spec('api', 'code:\n  - src/api.ts\nrelated:\n  - src/a.ts\n  - src/b.ts\n') },
    { path: '.spec/app/api/routes/spec.md', text: spec('routes') },
    { path: '.spec/app/.plugins/skills/atlas/spec.md', text: spec('atlas') },
  ], new Set(['.spec/app/api/diagram.json']))
  assert.deepEqual(roots, ['app'])
  assert.deepEqual(byId.get('app').children, ['api'])
  assert.deepEqual(byId.get('api').children, ['routes'])
  assert.equal(byId.get('api').diagram, '.spec/app/api/diagram.json')
  assert.deepEqual(byId.get('api').code, ['src/api.ts'])
  assert.deepEqual(byId.get('api').related, ['src/a.ts', 'src/b.ts'])
  assert.equal(byId.has('atlas'), false)
  assert.deepEqual(parseSpec('no frontmatter').fm, {})
})

test('a spec body renders escaped, with mentions linked only when they name a node', () => {
  const html = renderMarkdown('## Parts\n\nSee [[api]] and [[gone]]: `<b>` **x**\n\n- one\n- two\n\n```\n<script>\n```', (id) => id === 'api')
  assert.match(html, /<h2>Parts<\/h2>/)
  assert.match(html, /<a href="#" data-node="api">api<\/a>/)
  assert.match(html, /<span class="missing">gone<\/span>/)
  assert.match(html, /<code>&lt;b&gt;<\/code>/)
  assert.match(html, /<ul>\n<li>one<\/li>\n<li>two<\/li>\n<\/ul>/)
  assert.match(html, /<pre><code>&lt;script&gt;<\/code><\/pre>/)
  assert.doesNotMatch(html, /<script>|<b>/)
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
  const dir = join(root, 'distribution/gugu/spexcode-atlas')
  const html = readFileSync(join(dir, 'index.html'), 'utf8')
  const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(([, src]) => src)
  assert.ok(scripts.length >= 2, 'the page should load several classic scripts')
  const source = scripts.map((src) => readFileSync(join(dir, src), 'utf8')).join('\n;\n')
  // new Function parses without running: a duplicate declaration is a SyntaxError here exactly as in the browser.
  assert.doesNotThrow(() => new Function(source), SyntaxError)
})

test('every package names only files that exist, and the ZCode skill points at the workflow it ships', () => {
  const zcodeSkill = readFileSync(join(root, 'distribution/zcode/atlas/skills/atlas/SKILL.md'), 'utf8')
  assert.match(zcodeSkill, /\$\{ZCODE_SKILL_DIR\}\/atlas\.dwf\.ts/)
  assert.ok(existsSync(join(root, 'distribution/zcode/atlas/skills/atlas/atlas.dwf.ts')))
  const manifest = JSON.parse(readFileSync(join(root, 'distribution/gugu/spexcode-atlas/manifest.json'), 'utf8'))
  assert.ok(existsSync(join(root, 'distribution/gugu/spexcode-atlas', manifest.entry)))
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/)
  const html = readFileSync(join(root, 'distribution/gugu/spexcode-atlas', manifest.entry), 'utf8')
  for (const [, ref] of html.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(existsSync(join(root, 'distribution/gugu/spexcode-atlas', ref)), ref)
  // Codex reads the same shape as Claude Code under its own dotted directory; its manifest points at the folder.
  const codex = JSON.parse(readFileSync(join(root, 'distribution/codex/atlas/.codex-plugin/plugin.json'), 'utf8'))
  assert.ok(existsSync(join(root, 'distribution/codex/atlas', codex.skills)), codex.skills)
  assert.ok(existsSync(join(root, 'distribution/codex/atlas/skills/atlas/SKILL.md')))
  for (const pkg of ['distribution/penguin/use-spexcode']) {
    const listed = JSON.parse(readFileSync(join(root, pkg, 'package.json'), 'utf8')).files
    for (const file of listed) assert.ok(existsSync(join(root, pkg, file)), `${pkg}/${file}`)
  }
})
