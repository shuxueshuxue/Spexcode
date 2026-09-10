#!/usr/bin/env node
// Derives assets/diagram.css — the styles an inline diagram SVG needs — from the viewer page's stylesheet in
// assets/template.html, so a host page can show renderDiagram()'s SVG without the viewer. Re-run after
// syncing the template from upstream; `--check` fails when the committed file is stale.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'assets/diagram.css');
const template = fs.readFileSync(path.join(root, 'assets/template.html'), 'utf8');
const stylesheet = template.match(/<style>([\s\S]*?)<\/style>/)?.[1];
if (!stylesheet) throw new Error('assets/template.html has no <style> block');

// A diagram rule targets the SVG: it names the svg element, the renderer's data attributes, one of the
// renderer's class families (c- shape, t- text, a- arrow, m- marker), or the edge-flow overlay that browser.mjs
// draws. Viewer chrome that happens to hold an svg (toolbar icons, minimap, cards…) is not part of the diagram.
const DIAGRAM = /(^|[\s>+~(])svg(?![\w-])|\[data-(node-id|edge-from|edge-to|focus-|detail)|\.[ctam]-[\w-]|\.relationship-(flow-pulse|pulse-overlay)/;
const CHROME = /\.(cards|card\b|header|guided|story|chapter|share|finder|route-probe|semantic-lens|lens-|minimap|toolbar|passport|focus-chip|export|help|reach|journey|detail-rail|dock|panel|subtitle|site-|brand-lockup|diagram-nav|overview-map)/;
const PAGE = /^(html|:root|body)(?![\w-])|^\[data-(theme|preset)=/;

function rules(text) {
  const out = [];
  let i = 0;
  while (i < text.length) {
    const open = text.indexOf('{', i);
    if (open < 0) break;
    let depth = 1, j = open + 1;
    while (j < text.length && depth) { if (text[j] === '{') depth++; else if (text[j] === '}') depth--; j++; }
    out.push({ head: text.slice(i, open).replace(/\/\*[\s\S]*?\*\//g, '').trim(), body: text.slice(open + 1, j - 1).replace(/\/\*[\s\S]*?\*\//g, '') });
    i = j;
  }
  return out;
}

// @@@one box - the viewer spreads a diagram's state over <html> (theme, preset, motion) and .diagram-container
// (detail level). Inline, both collapse into the single host element `.archify`: page-root and container
// compounds merge into it, everything else hangs below it. The preset is the exception — the SVG carries its own
// data-preset, so preset variables are set on the svg and inherit from there.
const COMPOUND = /^(?:html|:root|body|\.diagram-container)?(?:\[[^\]]*\]|:not\((?:[^()]|\([^()]*\))*\)|\.[\w-]+)*/;
function scope(selector) {
  let state = '';
  let preset = '';
  let rest = selector;
  for (let pass = 0; pass < 2; pass += 1) {
    if (!/^(html|:root|body|\.diagram-container|\[data-(theme|preset)=)/.test(rest)) break;
    const compound = rest.match(COMPOUND)[0];
    rest = rest.slice(compound.length).replace(/^\s+/, '');
    const attrs = compound.replace(/^(html|:root|body|\.diagram-container)/, '');
    preset += (attrs.match(/\[data-preset=[^\]]*\]/g) ?? []).join('');
    state += attrs.replace(/\[data-preset=[^\]]*\]/g, '');
    if (!rest.startsWith('.diagram-container')) break;
  }
  if (preset) rest = rest.startsWith('svg') ? rest.replace(/^svg/, `svg${preset}`) : `svg${preset}${rest ? ` ${rest}` : ''}`;
  return `.archify${state}${rest ? (/^[>+~]/.test(rest) ? ` ${rest}` : ` ${rest}`) : ''}`;
}

// Keyframes are kept when a kept animation declaration names them (the name can sit anywhere in the shorthand).
const defined = new Map(rules(stylesheet).filter((r) => r.head.startsWith('@keyframes ')).map((r) => [r.head.slice(11).trim(), r.body]));
// @@@host state - the viewer script drives dozens of states (lens, route, story, reach, chapter, presentation…)
// by stamping attributes on <html>, the container and the svg. The inline host drives two: the detail level on the
// box (the viewer's default is "read": fine labels wait for hover or focus) and focus on the svg. A selector that
// needs any other script-set attribute can never match, so it is left out. The svg's own renderer-emitted
// attributes (preset, quality profile) and the host's theme stay; the optional trace animation is started only by
// the viewer's ambient-motion script, so its rules go too.
const HOST_BOX = new Set(['data-theme', 'data-detail-level']);
const HOST_SVG = new Set(['data-preset', 'data-quality-profile', 'data-focus-active']);
function hostReachable(scoped) {
  const [, box = '', svg = ''] = scoped.match(/^\.archify(\S*)(?:\s+(svg\S*))?/) ?? [];
  const positive = box.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, '');
  if (/\.[\w-]/.test(positive)) return false;
  const names = (compound) => [...compound.replace(/:not\((?:[^()]|\([^()]*\))*\)/g, '').matchAll(/\[([\w-]+)/g)].map((m) => m[1]);
  return names(positive).every((n) => HOST_BOX.has(n)) && names(svg).every((n) => HOST_SVG.has(n));
}

// @@@palette - the viewer keys its palette on <html data-theme="light|dark"> (the three non-classic presets on
// data-preset as well). Inline, the box follows the host page's own color-scheme instead: a variable whose value
// differs between the two themes becomes light-dark(light, dark), so a themed host gets the matching palette with
// no script, and data-theme on the box still pins one. A preset's variable falls back to the base theme's, as
// the cascade does in the viewer (a preset block is more specific than the base one).
const palette = new Map(); // preset ('' = base) → { light: {name: value}, dark: {name: value} }
function addToPalette(selectors, declarations) {
  const presets = new Set(selectors.map((s) => s.match(/\[data-preset="([^"]+)"\]/)?.[1] ?? ''));
  if (presets.size !== 1) throw new Error(`palette rule mixes presets: ${selectors.join(', ')}`);
  const preset = [...presets][0];
  const schemes = new Set(selectors.flatMap((s) => {
    const theme = s.match(/\[data-theme="(light|dark)"\]/)?.[1];
    return theme ? [theme] : ['light', 'dark'];
  }));
  if (!palette.has(preset)) palette.set(preset, { light: {}, dark: {} });
  for (const d of declarations) {
    const colon = d.indexOf(':');
    for (const scheme of schemes) palette.get(preset)[scheme][d.slice(0, colon).trim()] = d.slice(colon + 1).trim();
  }
}
const COLOR = /^(#[0-9a-f]{3,8}|(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color-mix|color|var)\(|transparent$|[a-z]+$)/i;
function merged(light, dark) {
  return [...new Set([...Object.keys(light), ...Object.keys(dark)])].map((name) => {
    const l = light[name], d = dark[name];
    if (l === undefined || d === undefined) throw new Error(`${name} is defined for one theme only`);
    if (l === d) return `${name}: ${l}`;
    if (!COLOR.test(l) || !COLOR.test(d)) throw new Error(`${name} differs between themes but is not a colour: ${l} | ${d}`);
    return `${name}: light-dark(${l}, ${d})`;
  }).join('; ');
}
function paletteRules() {
  const base = palette.get('');
  if (!base) throw new Error('the template defines no base palette');
  const out = [
    `.archify { ${merged(base.light, base.dark)}; }`,
    '.archify[data-theme="light"] { color-scheme: light; }',
    '.archify[data-theme="dark"] { color-scheme: dark; }',
  ];
  for (const [preset, own] of palette) {
    if (!preset) continue;
    const names = new Set([...Object.keys(own.light), ...Object.keys(own.dark)]);
    const pick = (scheme) => Object.fromEntries([...names].map((n) => [n, own[scheme][n] ?? base[scheme][n]]));
    out.push(`.archify svg[data-preset="${preset}"] { ${merged(pick('light'), pick('dark'))}; }`);
  }
  return out;
}

const keyframes = new Set();
function walk(list, nested = false) {
  const out = [];
  for (const rule of list) {
    if (/^@(media|supports)/.test(rule.head)) {
      const inner = walk(rules(rule.body), true);
      if (inner.length) out.push(`${rule.head} {\n${inner.map((line) => `  ${line}`).join('\n')}\n}`);
      continue;
    }
    if (rule.head.startsWith('@')) continue;
    const selectors = rule.head.split(',').map((s) => s.trim()).filter(Boolean);
    const declarations = rule.body.split(';').map((d) => d.trim()).filter(Boolean);
    const diagram = selectors.filter((s) => DIAGRAM.test(s) && !CHROME.test(s)).map(scope).filter(hostReachable);
    if (diagram.length) {
      for (const d of declarations.filter((d) => d.startsWith('animation'))) for (const name of defined.keys()) if (new RegExp(`(^|[\\s:,])${name}([\\s,;]|$)`).test(d)) keyframes.add(name);
      out.push(`${diagram.join(', ')} { ${declarations.join('; ')}; }`);
      continue;
    }
    // Page-level rules contribute only what the diagram takes from the page: its custom properties (colours,
    // spacing), and from the page body its typeface and the canvas it is drawn on. At the top level they form the
    // palette; inside a media query (print) they override it as written.
    const canvas = selectors.length === 1 && selectors[0] === 'body';
    const inherited = declarations.filter((d) => d.startsWith('--') || (canvas && /^(font-family|background)\s*:/.test(d)));
    if (!inherited.length || !selectors.every((s) => PAGE.test(s))) continue;
    if (nested) out.push(`${selectors.map(scope).join(', ')} { ${inherited.join('; ')}; }`);
    else addToPalette(selectors, inherited);
  }
  return out;
}

const walked = walk(rules(stylesheet));
const body = [...paletteRules(), ...walked];
for (const name of keyframes) body.push(`@keyframes ${name} {${defined.get(name)}}`);
// The one rule the viewer does not have: its edge pulse runs once per hover, while a focused node's edges keep
// flowing until the focus is cleared.
body.push('.archify .relationship-pulse-overlay .relationship-flow-pulse { animation-iteration-count: infinite; }');
const generated = `/* Generated by scripts/generate-diagram-css.mjs from assets/template.html. Do not edit by hand.
   Host contract: put the SVG from renderDiagram() inside <div class="archify" data-detail-level="read">. The palette
   follows the page's color-scheme (data-theme="light|dark" on the box pins one); detail levels are map < read < full;
   @spexcode/archify/browser scopes its ids (scopeIds) and drives focus and edge flow (focusDiagram). */
${body.join('\n')}
`;

if (process.argv.includes('--check')) {
  const current = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '';
  if (current !== generated) {
    console.error('assets/diagram.css is stale — run node scripts/generate-diagram-css.mjs');
    process.exit(1);
  }
} else {
  fs.writeFileSync(output, generated);
  console.log(`wrote ${path.relative(root, output)} (${(generated.length / 1024).toFixed(1)} KB)`);
}
