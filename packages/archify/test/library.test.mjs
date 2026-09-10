// The library face ([[archify]]): the in-process API must produce what the CLI produces, byte for byte.
// test/example-pages.sha256.json holds the sha256 of each example's page as `archify render --quality <profile>`
// wrote it before the renderers became functions; the library has to reproduce those exact bytes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkDiagram, DiagramError, diagramHtml, layoutReport, renderDiagram } from '../index.mjs';

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

test('diagram.css is generated from the template, and every rule stays inside the .archify box', () => {
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('scripts/generate-diagram-css.mjs', root)), '--check'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
  const css = fs.readFileSync(new URL('assets/diagram.css', root), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [...css.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '').matchAll(/([^{}]+)\{[^{}]*\}/g)]
    .flatMap((m) => m[1].replace(/@media[^{]*\{/g, '').split(',')).map((s) => s.trim()).filter(Boolean);
  assert.ok(selectors.length > 100, `${selectors.length} selectors`);
  for (const s of selectors) assert.match(s, /^\.archify(?![\w-])/, s);
});

test('scopeIds makes an inline SVG self-contained: every id it defines and every reference carries the prefix', async () => {
  const { scopeIds } = await import('../browser.mjs');
  for (const f of examples) {
    const ir = read(f);
    const scoped = scopeIds((await renderDiagram(typeOf(f), ir, optsOf(ir))).svg, 'd1');
    const ids = new Set([...scoped.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
    assert.ok(ids.size > 0, f);
    for (const id of ids) assert.ok(id.startsWith('d1-'), `${f}: unscoped id ${id}`);
    for (const m of scoped.matchAll(/url\(#([^)]+)\)|href="#([^"]+)"/g)) assert.ok(ids.has(m[1] ?? m[2]), `${f}: dangling ${m[0]}`);
    for (const m of scoped.matchAll(/aria-(?:labelledby|describedby)="([^"]+)"/g)) {
      for (const id of m[1].split(/\s+/)) assert.ok(ids.has(id), `${f}: dangling aria reference ${id}`);
    }
  }
});

test('the generated validators are up to date with the schemas', () => {
  const run = spawnSync(process.execPath, [fileURLToPath(new URL('scripts/generate-validators.mjs', root)), '--check'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
