// The library face ([[archify]]): the in-process API must produce what the CLI produces, byte for byte.
// test/example-pages.sha256.json holds the sha256 of each example's page as `archify render --quality <profile>`
// wrote it before the renderers became functions; the library has to reproduce those exact bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkDiagram, DiagramError, diagramHtml, layoutReport, renderDiagram, runtimeAssets } from '../index.mjs';

const root = new URL('..', import.meta.url);
const examples = fs.readdirSync(new URL('examples/', root)).filter((f) => f.endsWith('.json')).sort();
const expected = JSON.parse(fs.readFileSync(new URL('test/example-pages.sha256.json', root), 'utf8'));
const read = (f) => JSON.parse(fs.readFileSync(new URL(`examples/${f}`, root), 'utf8'));
const typeOf = (f) => f.replace(/\.json$/, '').split('.').pop();
const optsOf = (ir) => ({ quality: ir.meta?.quality_profile || 'standard' });

test('every example renders in-process to the exact bytes the CLI delivered', async () => {
  assert.equal(examples.length, 5, 'one example per diagram type');
  for (const f of examples) {
    const ir = read(f);
    const html = diagramHtml(await renderDiagram(typeOf(f), ir, optsOf(ir)));
    assert.equal(createHash('sha256').update(html).digest('hex'), expected[f.replace(/\.json$/, '')], f);
  }
});

test('every example passes the final-artifact check, and layout reports exist where the CLI gives one', async () => {
  for (const f of examples) {
    const ir = read(f); const type = typeOf(f);
    const result = await checkDiagram(type, ir, optsOf(ir));
    assert.equal(result.ok, true, `${f}: ${JSON.stringify(result.diagnostics)}`);
    assert.ok(result.checks.length > 0);
    if (type === 'architecture' || type === 'workflow') assert.equal(typeof (await layoutReport(type, ir, optsOf(ir))), 'object');
  }
});

test('a diagram problem is data, not a crash: render throws DiagramError, check returns ok:false', async () => {
  const ir = read('web-app.architecture.json');
  ir.connections = [...(ir.connections || []), { from: 'no-such-component', to: ir.components[0].id }];
  await assert.rejects(renderDiagram('architecture', ir), (error) => error instanceof DiagramError && error.diagnostics.length > 0);
  const result = await checkDiagram('architecture', ir);
  assert.equal(result.ok, false);
  assert.ok(result.diagnostics.length > 0);
  await assert.rejects(renderDiagram('pie', {}), DiagramError);
});

test('a linked page carries no viewer code of its own and names the content-hashed shared runtime', async () => {
  const ir = read('web-app.architecture.json');
  const parts = await renderDiagram('architecture', ir, optsOf(ir));
  const inline = diagramHtml(parts);
  const linked = diagramHtml(parts, { runtime: { base: '../assets/archify' } });
  const assets = runtimeAssets();
  assert.deepEqual(assets.map((a) => a.name.replace(/\.[0-9a-f]{10}\./, '.#.')), ['archify-fonts.#.css', 'archify-viewer.#.css', 'archify-viewer.#.js']);
  for (const a of assets) {
    assert.ok(linked.includes(`../assets/archify/${a.name}`), a.name);
    assert.ok(!linked.includes(a.content.slice(0, 200)), `${a.name} is not inlined`);
    assert.ok(inline.includes(a.content.slice(0, 200)), `${a.name} is inlined in the self-contained page`);
  }
  assert.ok(linked.length < inline.length / 5, `linked page ${linked.length} B vs inline ${inline.length} B`);
});

test('the generated validators are up to date with the schemas', () => {
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('scripts/generate-validators.mjs', root)), '--check'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
