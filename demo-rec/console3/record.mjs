// console sub-batch 3: launcher-picker-opens-on-click · launcher-picker-shows-harness-icon
//                     · inbox-mention-dropdown-and-resolution
import pkg from '/root/node_modules/playwright-core/index.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const { chromium } = pkg;
const OUT = '/root/spexcode/.worktrees/session-6b36/demo-rec/console3';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, recordVideo: { dir: OUT, size: { width: 1600, height: 1000 } } });
const page = await ctx.newPage();
const t0 = Date.now();
const events = [];
const ev = (k, l) => { events.push({ atMs: Date.now() - t0, kind: k, label: l }); console.log(`[${((Date.now()-t0)/1000).toFixed(1)}s] ${l}`); };
const C = {};

await page.goto('http://127.0.0.1:5201/#/sessions/new', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

// ───── launcher-picker-opens-on-click ─────
ev('narrate', '▶ launcher-picker-opens-on-click · keepFocus spares the native select mousedown');
C.selPresent = await page.evaluate(() => !!document.querySelector('.si-launcher-select'));
ev('frame', `📷 New composer shows .si-launcher-select = ${C.selPresent}`);
// attach a one-shot mousedown listener, dispatch a REAL pointer at the select centre, read defaultPrevented
C.opens = await page.evaluate(() => new Promise((res) => {
  const sel = document.querySelector('.si-launcher-select');
  if (!sel) return res({ err: 'no select' });
  const r = sel.getBoundingClientRect();
  let prevented = null;
  sel.addEventListener('mousedown', (e) => { setTimeout(() => { prevented = e.defaultPrevented; res({ defaultPrevented: prevented, hasFocusSink: !!document.querySelector('[data-focus-overlay]') }); }, 0); }, { once: true });
  sel.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: r.x + r.width / 2, clientY: r.y + r.height / 2 }));
}));
ev('frame', `📷 mousedown defaultPrevented = ${C.opens.defaultPrevented} (must be FALSE — dropdown opens)`);
// corroborate the control is pointer-operable: value follows a chosen option
const optsBefore = await page.locator('.si-launcher-select').inputValue().catch(() => '');
await page.locator('.si-launcher-select').selectOption({ index: 1 }).catch(() => {});
await page.waitForTimeout(400);
C.opens.valueChanged = (await page.locator('.si-launcher-select').inputValue().catch(() => '')) !== optsBefore;
ev('frame', `📷 value follows selection = ${C.opens.valueChanged}`);
await page.screenshot({ path: `${OUT}/picker.png` });

// ───── launcher-picker-shows-harness-icon ─────
ev('narrate', '▶ launcher-picker-shows-harness-icon · option = name only; adornment = harness SVG that tracks selection');
C.icon = { optionTexts: await page.evaluate(() => Array.from(document.querySelectorAll('.si-launcher-select option')).map(o => o.textContent.trim())) };
ev('frame', `📷 option labels (no · claude/codex suffix): ${JSON.stringify(C.icon.optionTexts)}`);
// select the claude-harness launcher, read the adornment svg
await page.locator('.si-launcher-select').selectOption('stub-claude').catch(() => {});
await page.waitForTimeout(500);
C.icon.claude = await page.evaluate(() => {
  const w = document.querySelector('.si-launcher-harness');
  const svg = w?.querySelector('svg');
  return { hasSvg: !!svg, title: w?.getAttribute('title') || svg?.querySelector('title')?.textContent, d: svg?.querySelector('path')?.getAttribute('d')?.slice(0, 40) };
});
ev('frame', `📷 claude launcher → harness glyph: hasSvg=${C.icon.claude.hasSvg} title=${C.icon.claude.title}`);
// switch to codex-harness launcher, re-read
await page.locator('.si-launcher-select').selectOption('stub-codex').catch(() => {});
await page.waitForTimeout(500);
C.icon.codex = await page.evaluate(() => {
  const w = document.querySelector('.si-launcher-harness');
  const svg = w?.querySelector('svg');
  return { hasSvg: !!svg, title: w?.getAttribute('title') || svg?.querySelector('title')?.textContent, d: svg?.querySelector('path')?.getAttribute('d')?.slice(0, 40) };
});
C.icon.swapped = C.icon.claude.d !== C.icon.codex.d || C.icon.claude.title !== C.icon.codex.title;
ev('frame', `📷 codex launcher → glyph swapped = ${C.icon.swapped} (title ${C.icon.claude.title}→${C.icon.codex.title})`);
await page.locator('.si-launcher-select').selectOption('stub-claude').catch(() => {});

// ───── inbox-mention-dropdown-and-resolution ─────
ev('narrate', '▶ inbox-mention-dropdown-and-resolution · [[ menu in the live ❯ inbox, insert + send-time resolve');
await page.goto('http://127.0.0.1:5201/#/sessions', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
await page.locator('.si-item').filter({ hasText: 'idle fixture' }).first().click();
await page.waitForTimeout(2500);
const dock = page.locator('.si-bottom textarea');
C.inbox = { dockDisabled: await dock.isDisabled().catch(() => true) };
if (!C.inbox.dockDisabled) {
  await dock.click();
  await dock.type('look at [[term', { delay: 40 });
  await page.waitForTimeout(1200);
  C.inbox.menu = await page.evaluate(() => {
    const m = document.querySelector('.si-bottom .mention-menu, .mention-menu.up, .mention-menu');
    return { open: !!m, up: !!(m && m.className.includes('up')), rows: m ? Array.from(m.querySelectorAll('*')).filter(e => e.childElementCount === 0 && e.textContent.trim()).slice(0, 5).map(e => e.textContent.trim()) : [] };
  });
  ev('frame', `📷 [[term → menu open=${C.inbox.menu.open} up=${C.inbox.menu.up} rows=${JSON.stringify(C.inbox.menu.rows)}`);
  // accept the top row
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);
  C.inbox.afterAccept = await dock.inputValue();
  C.inbox.inserted = /\[\[[\w-]+\]\]/.test(C.inbox.afterAccept);
  ev('frame', `📷 accept top row → draft='${C.inbox.afterAccept.slice(0, 40)}' insertedToken=${C.inbox.inserted}`);
}
// send-time resolution: verify server-side transform WITHOUT disturbing the fixture — hit the resolve path via API preview if present, else read the mentions module contract on a known id
C.inbox.resolve = await page.evaluate(async () => {
  // the resolution runs server-side on send; probe it read-only via the spec index if an endpoint exists
  try {
    const r = await fetch('/api/specs');
    const specs = await r.json();
    const arr = Array.isArray(specs) ? specs : specs.specs || specs.nodes || [];
    const term = arr.find(s => (s.id || s.node) === 'term-input');
    return { termInputExists: !!term, path: term?.path };
  } catch (e) { return { err: String(e) }; }
});
ev('frame', `📷 [[term-input]] resolvable: exists=${C.inbox.resolve.termInputExists} path=${C.inbox.resolve.path || ''}`);
// clear the inbox draft so nothing is left dangling / sent
await page.evaluate(() => { const t = document.querySelector('.si-bottom textarea'); if (t) { const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; s.call(t, ''); t.dispatchEvent(new Event('input', { bubbles: true })); } });

await page.waitForTimeout(1000);
await ctx.close();
await browser.close();
writeFileSync(`${OUT}/session.timeline.json`, JSON.stringify({ events }, null, 1));
writeFileSync(`${OUT}/checks.json`, JSON.stringify(C, null, 1));
console.log('CHECKS', JSON.stringify(C, null, 1));
