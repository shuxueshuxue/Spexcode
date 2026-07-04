// console mechanics sub-batch 1 on the idle reclaude fixture (99248043).
// Scenarios: terminal-proof-tabs · input-grows-no-premature-scrollbar · input-dock-reserves-bottom-strip
//            · status-word-colour (partial palette per owner guidance)
import pkg from '/root/node_modules/playwright-core/index.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const { chromium } = pkg;
const OUT = '/root/spexcode/.worktrees/session-6b36/demo-rec/console1';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, recordVideo: { dir: OUT, size: { width: 1600, height: 1000 } } });
const page = await ctx.newPage();
const t0 = Date.now();
const events = [];
const ev = (k, l) => { events.push({ atMs: Date.now() - t0, kind: k, label: l }); console.log(`[${((Date.now()-t0)/1000).toFixed(1)}s] ${l}`); };
const C = {};

await page.goto('http://127.0.0.1:5201/#/sessions', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);

// ───── terminal-proof-tabs ─────
ev('narrate', '▶ terminal-proof-tabs · tab bar, inline proof, term survives round-trip');
await page.locator('.si-item').filter({ hasText: 'idle fixture' }).first().click();
await page.waitForTimeout(3000);
ev('frame', '📷 console open on live fixture');
C.tabs = await page.evaluate(() => ({
  tabs: Array.from(document.querySelectorAll('.si-tab')).map(e => ({ t: e.textContent.trim(), on: e.className.includes('on') })),
  termVisible: !!document.querySelector('.si-term-body')?.offsetParent,
  dock: !!document.querySelector('.si-bottom textarea')?.offsetParent,
  dockDisabled: document.querySelector('.si-bottom textarea')?.disabled,
  tabbarBg: getComputedStyle(document.querySelector('.si-tabbar')).backgroundColor,
  termBg: getComputedStyle(document.querySelector('.si-term-body')).backgroundColor,
}));
ev('frame', `📷 default tab=${JSON.stringify(C.tabs.tabs)} termVisible=${C.tabs.termVisible}`);
// grow the ❯ box multi-line (unsent draft), then round-trip tabs
const dock = page.locator('.si-bottom textarea');
if (await dock.count() && !C.tabs.dockDisabled) {
  await dock.click();
  await dock.type('line1', { delay: 10 });
  for (let i = 0; i < 4; i++) { await page.keyboard.press('Shift+Enter').catch(() => {}); await dock.type(`line${i+2}`, { delay: 10 }); }
  await page.waitForTimeout(600);
}
C.grownBefore = await page.evaluate(() => document.querySelector('.si-bottom textarea')?.getBoundingClientRect().height);
ev('frame', `📷 ❯ grown to ${Math.round(C.grownBefore || 0)}px (unsent draft)`);
// switch to the second tab (proof/eval — read what it actually is)
const tab2 = page.locator('.si-tab').nth(1);
const tab2name = (await tab2.textContent()).trim();
await tab2.click();
await page.waitForTimeout(2500);
C.tab2 = await page.evaluate(() => ({
  termInDom: !!document.querySelector('.si-term-body'),
  termDisplay: document.querySelector('.si-term-body') ? getComputedStyle(document.querySelector('.si-term-body')).display : null,
  dockVisible: !!document.querySelector('.si-bottom textarea')?.offsetParent,
  proofPane: !!document.querySelector('.proof-pane'), evalPane: !!document.querySelector('[class*=eval]'),
  iframe: !!document.querySelector('.proof-pane iframe, iframe'),
  paneClasses: Array.from(document.querySelectorAll('.si-content [class]')).map(e => String(e.className).split(' ')[0]).filter((c,i,a) => a.indexOf(c)===i).slice(0, 12),
}));
ev('frame', `📷 tab2(${tab2name}): termInDom=${C.tab2.termInDom} display=${C.tab2.termDisplay} proofPane=${C.tab2.proofPane}`);
await page.locator('.si-tab').first().click();
await page.waitForTimeout(2000);
C.roundtrip = await page.evaluate(() => ({
  termVisible: !!document.querySelector('.si-term-body')?.offsetParent,
  dockH: document.querySelector('.si-bottom textarea')?.getBoundingClientRect().height,
  draft: (document.querySelector('.si-bottom textarea')?.value || '').split('\n').length,
}));
ev('frame', `📷 back on terminal: visible=${C.roundtrip.termVisible} dockH=${Math.round(C.roundtrip.dockH||0)} draftLines=${C.roundtrip.draft}`);
// clear the draft so nothing dangles
await page.evaluate(() => { const t = document.querySelector('.si-bottom textarea'); if (t) { const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; s.call(t, ''); t.dispatchEvent(new Event('input', { bubbles: true })); } });

// dark theme tabbar contrast
await page.goto('http://127.0.0.1:5201/#/settings', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await page.getByText(/dark|深色/i).first().click().catch(() => {});
await page.waitForTimeout(1000);
await page.goto('http://127.0.0.1:5201/#/sessions', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
await page.locator('.si-item').filter({ hasText: 'idle fixture' }).first().click();
await page.waitForTimeout(2000);
C.darkTabbar = await page.evaluate(() => ({
  tabbarBg: getComputedStyle(document.querySelector('.si-tabbar')).backgroundColor,
  termBg: getComputedStyle(document.querySelector('.si-term-body')).backgroundColor,
}));
ev('frame', `📷 dark theme: tabbar=${C.darkTabbar.tabbarBg} vs term=${C.darkTabbar.termBg}`);
// back to light
await page.goto('http://127.0.0.1:5201/#/settings', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1200);
await page.getByText(/light|浅色/i).first().click().catch(() => {});
await page.waitForTimeout(800);

// ───── input-dock-reserves-bottom-strip ─────
ev('narrate', '▶ input-dock-reserves-bottom-strip · terminal ends above the resting dock; growth overlays');
await page.goto('http://127.0.0.1:5201/#/sessions', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2000);
await page.locator('.si-item').filter({ hasText: 'idle fixture' }).first().click();
await page.waitForTimeout(2500);
C.dockRest = await page.evaluate(() => {
  const term = document.querySelector('.si-term-body')?.getBoundingClientRect();
  const bot = document.querySelector('.si-bottom')?.getBoundingClientRect();
  return term && bot ? { termBottom: term.bottom, botTop: bot.top, overlap: term.bottom > bot.top + 1, termRect: { y: term.y, h: term.height } } : null;
});
ev('frame', `📷 rest: term.bottom=${Math.round(C.dockRest?.termBottom||0)} dock.top=${Math.round(C.dockRest?.botTop||0)} overlap=${C.dockRest?.overlap}`);
const dock2 = page.locator('.si-bottom textarea');
if (await dock2.count() && !(await dock2.first().isDisabled())) {
  await dock2.click();
  for (let i = 0; i < 5; i++) { await dock2.type(`g${i}`, { delay: 8 }); await page.keyboard.press('Shift+Enter').catch(() => {}); }
  await page.waitForTimeout(700);
}
C.dockGrown = await page.evaluate(() => {
  const term = document.querySelector('.si-term-body')?.getBoundingClientRect();
  return term ? { y: term.y, h: term.height } : null;
});
ev('frame', `📷 grown: term rect y=${Math.round(C.dockGrown?.y||0)} h=${Math.round(C.dockGrown?.h||0)} (unchanged=${C.dockRest && C.dockGrown && Math.abs(C.dockRest.termRect.h - C.dockGrown.h) < 2})`);
await page.evaluate(() => { const t = document.querySelector('.si-bottom textarea'); if (t) { const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; s.call(t, ''); t.dispatchEvent(new Event('input', { bubbles: true })); } });

// ───── input-grows-no-premature-scrollbar ─────
ev('narrate', '▶ input-grows-no-premature-scrollbar · New prompt grows without a scrollbar below the cap');
await page.locator('.si-item, .si-pill').filter({ hasText: /new session|New/i }).first().click().catch(async () => { await page.goto('http://127.0.0.1:5201/#/sessions/new', { waitUntil: 'domcontentloaded' }); });
await page.waitForTimeout(1500);
const inp = page.getByPlaceholder(/describe the work/).first();
await inp.click();
const readBox = () => page.evaluate(() => { const t = document.querySelector('.si-input[placeholder*="describe"]') || document.querySelector('.si-input'); const cs = getComputedStyle(t); return { h: t.getBoundingClientRect().height, oy: cs.overflowY, scrollable: t.scrollHeight > t.clientHeight + 1 }; });
C.growth = [];
await inp.type('one line', { delay: 8 });
await page.waitForTimeout(400); C.growth.push(await readBox());
for (const n of [2, 4, 7]) {
  while ((await page.evaluate(() => (document.querySelector('.si-new-center .si-input, .si-input[placeholder*="describe"]').value.match(/\n/g) || []).length)) < n - 1) await page.keyboard.press('Shift+Enter');
  await inp.type(`line ${n}`, { delay: 5 });
  await page.waitForTimeout(400);
  C.growth.push(await readBox());
  ev('frame', `📷 ${n} lines: h=${Math.round(C.growth.at(-1).h)} overflowY=${C.growth.at(-1).oy}`);
}
for (let i = 0; i < 8; i++) await page.keyboard.press('Shift+Enter');
await inp.type('past the cap', { delay: 5 });
await page.waitForTimeout(500);
C.growth.push(await readBox());
ev('frame', `📷 past cap: h=${Math.round(C.growth.at(-1).h)} overflowY=${C.growth.at(-1).oy} scrollable=${C.growth.at(-1).scrollable}`);
await page.evaluate(() => { const t = document.querySelector('.si-input[placeholder*="describe"]') || document.querySelector('.si-input'); const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; s.call(t, ''); t.dispatchEvent(new Event('input', { bubbles: true })); });

// ───── status-word-colour (partial: real working/offline + map) ─────
ev('narrate', '▶ status-word-colour · real states painted by the STATUS_COLOR buckets');
await page.goto('http://127.0.0.1:5201/#/graph', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
C.statusColours = await page.evaluate(() =>
  Array.from(document.querySelectorAll('.sess-row')).slice(0, 8).map(r => {
    const w = r.querySelector('[class*=status], .sess-meta span:last-child') || r;
    const word = Array.from(r.querySelectorAll('span,em,i,b')).map(e => e.textContent.trim()).filter(t => /working|asking|idle|offline|starting|review|done|error|parked|queued/.test(t))[0] || '';
    const el = Array.from(r.querySelectorAll('*')).find(e => e.childElementCount === 0 && e.textContent.trim() === word);
    return { label: r.textContent.trim().slice(0, 30), word, color: el ? getComputedStyle(el).color : null };
  }));
ev('frame', `📷 SessionWindow status words: ${JSON.stringify(C.statusColours)}`);

await page.waitForTimeout(1200);
await ctx.close();
await browser.close();
writeFileSync(`${OUT}/session.timeline.json`, JSON.stringify({ events }, null, 1));
writeFileSync(`${OUT}/checks.json`, JSON.stringify(C, null, 1));
console.log('CHECKS', JSON.stringify(C, null, 1));
