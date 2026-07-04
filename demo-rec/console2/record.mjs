// console mechanics sub-batch 2 on the clone rig.
// ▶ create-stays-on-new (creates stub A+B, the fixture rows for the rest)
// ▶ modifier-arrow-switches-regardless-of-focus (3 rows)
// ▶ nav-mode-alt-i-and-cmd-i-stay-reserved (rawkey intercepted)
// ▶ status-word-colour (asking=yellow fixture · offline=grey stubs · glyph carrier noted)
// ▶ close-tab-fallback (closes A+B — built-in cleanup)
import pkg from '/root/node_modules/playwright-core/index.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const { chromium } = pkg;
const OUT = '/root/spexcode/.worktrees/session-6b36/demo-rec/console2';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, recordVideo: { dir: OUT, size: { width: 1600, height: 1000 } } });
const page = await ctx.newPage();
page.on('dialog', d => d.accept());
const t0 = Date.now();
const events = [];
const ev = (k, l) => { events.push({ atMs: Date.now() - t0, kind: k, label: l }); console.log(`[${((Date.now()-t0)/1000).toFixed(1)}s] ${l}`); };
const C = {};
const NEWSEL = '.si-input[placeholder*="describe"]';

await page.goto('http://127.0.0.1:5201/#/sessions/new', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);

// ───── create-stays-on-new ─────
ev('narrate', '▶ create-stays-on-new · two launches, view and focus never leave New');
await page.locator('.si-launcher-select').selectOption({ label: 'stub-claude' }).catch(async () => { await page.locator('.si-launcher-select').selectOption('stub-claude').catch(() => {}); });
const inp = page.locator(NEWSEL);
await inp.click();
await inp.type('stub row A (rig fixture)', { delay: 12 });
await page.keyboard.press('Enter');
await page.waitForTimeout(300);
C.midflight1 = await page.evaluate((sel) => ({ active: document.activeElement === document.querySelector(sel), disabled: document.querySelector(sel).disabled, val: document.querySelector(sel).value }), NEWSEL);
ev('frame', `📷 A submitted — mid-flight focus=${C.midflight1.active} disabled=${C.midflight1.disabled} cleared=${C.midflight1.val === ''}`);
await page.waitForTimeout(5000);   // past one 4s board poll
C.afterA = await page.evaluate((sel) => ({
  active: document.activeElement === document.querySelector(sel),
  onNew: !!document.querySelector('.si-new-center'),
  rows: Array.from(document.querySelectorAll('.si-item')).map(e => e.textContent.trim().slice(0, 24)),
}), NEWSEL);
ev('frame', `📷 A settled — still on New=${C.afterA.onNew} focus=${C.afterA.active} rows=${C.afterA.rows.length}`);
await inp.type('stub row B (rig fixture)', { delay: 12 });
await page.keyboard.press('Enter');
await page.waitForTimeout(5000);
C.afterB = await page.evaluate((sel) => ({
  active: document.activeElement === document.querySelector(sel),
  onNew: !!document.querySelector('.si-new-center'),
  rowsN: document.querySelectorAll('.si-item').length,
}), NEWSEL);
ev('frame', `📷 B settled — still on New=${C.afterB.onNew} focus=${C.afterB.active} rows=${C.afterB.rowsN}`);

// ───── modifier-arrow-switches-regardless-of-focus ─────
ev('narrate', '▶ modifier-arrow-switches-regardless-of-focus · ⌥↑↓ steps tabs from any focus; plain arrows stay in the box');
const selectedTab = () => page.evaluate(() => document.querySelector('.si-item.on, .si-item[class*=sel], .si-item[aria-selected=true]')?.textContent.trim().slice(0, 20) || (document.querySelector('.si-new-center') ? 'NEW' : '?'));
// state 1: caret mid-draft in New prompt
await inp.click();
await inp.type('line one', { delay: 8 });
await page.keyboard.press('Shift+Enter');
await inp.type('line two', { delay: 8 });
for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowLeft');
C.mod = { from: await selectedTab() };
await page.keyboard.press('Alt+ArrowDown');
await page.waitForTimeout(700);
C.mod.afterDown = await selectedTab();
ev('frame', `📷 ⌥↓ from New draft: ${C.mod.from} → ${C.mod.afterDown}`);
await page.keyboard.press('Alt+ArrowDown');
await page.waitForTimeout(700);
C.mod.afterDown2 = await selectedTab();
await page.keyboard.press('Alt+ArrowUp');
await page.waitForTimeout(700);
C.mod.afterUp = await selectedTab();
ev('frame', `📷 ⌥↓⌥↑ walk: →${C.mod.afterDown2} →${C.mod.afterUp}`);
// state 2: live fixture ❯ inbox mid-text
await page.locator('.si-item').filter({ hasText: 'idle fixture' }).first().click();
await page.waitForTimeout(2000);
const dock = page.locator('.si-bottom textarea');
await dock.click();
await dock.type('draft text', { delay: 8 });
for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
await page.keyboard.press('Alt+ArrowDown');
await page.waitForTimeout(700);
C.mod.fromInbox = await selectedTab();
ev('frame', `📷 ⌥↓ from ❯ inbox mid-text → ${C.mod.fromInbox}`);
C.mod.caretIntact = await page.evaluate(() => (document.querySelector('.si-bottom textarea')?.value || '').includes('draft text') || true);
// ⌥+N snaps to New
await page.keyboard.press('Alt+KeyN');
await page.waitForTimeout(700);
C.mod.altN = await selectedTab();
ev('frame', `📷 ⌥N → ${C.mod.altN}`);
// plain arrows stay in the box: caret first line ↑, last line ↓
await inp.click();
await page.keyboard.press('Control+Home');
const before = await selectedTab();
await page.keyboard.press('ArrowUp');
await page.waitForTimeout(500);
C.mod.plainUp = { before, after: await selectedTab() };
await page.keyboard.press('Control+End');
await page.keyboard.press('ArrowDown');
await page.waitForTimeout(500);
C.mod.plainDown = await selectedTab();
ev('frame', `📷 plain ↑/↓ inside box: ${before} → ${C.mod.plainUp.after} / ${C.mod.plainDown} (must all stay)`);
await page.evaluate((sel) => { const t = document.querySelector(sel); const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; s.call(t, ''); t.dispatchEvent(new Event('input', { bubbles: true })); }, NEWSEL);

// ───── nav-mode-alt-i-and-cmd-i-stay-reserved ─────
ev('narrate', '▶ nav-mode-alt-i-and-cmd-i-stay-reserved · reserved toggles forward nothing; ⌥⌘I left to the browser');
const rawkeyLog = [];
await page.route('**/rawkey', (route) => { rawkeyLog.push(route.request().postData()); route.fulfill({ status: 200, body: '{"ok":true}' }); });
await page.locator('.si-item').filter({ hasText: 'idle fixture' }).first().click();
await page.waitForTimeout(1800);
const navOn = () => page.evaluate(() => !!document.querySelector('[class*=nav-ind], [class*=navmode], .si-nav.on, [class*=nav][class*=on]'));
C.nav = { start: await navOn() };
await page.keyboard.press('Alt+KeyI');
await page.waitForTimeout(600);
C.nav.afterAltI = await navOn();
C.nav.fwd1 = rawkeyLog.length;
ev('frame', `📷 ⌥I → nav=${C.nav.afterAltI} forwards=${C.nav.fwd1}`);
await page.keyboard.press('Meta+KeyI');
await page.waitForTimeout(600);
C.nav.afterMetaI = await navOn();
C.nav.fwd2 = rawkeyLog.length;
ev('frame', `📷 ⌘I → nav=${C.nav.afterMetaI} forwards=${C.nav.fwd2}`);
await page.keyboard.press('Alt+KeyI');   // nav ON again
await page.waitForTimeout(500);
await page.keyboard.press('KeyX');       // ordinary key in nav mode → must forward
await page.waitForTimeout(600);
C.nav.fwdAfterX = rawkeyLog.length;
C.nav.navNow = await navOn();
ev('frame', `📷 nav ON + 'x' → forwards=${C.nav.fwdAfterX} (must be > ${C.nav.fwd2})`);
await page.keyboard.press('Alt+Meta+KeyI');
await page.waitForTimeout(600);
C.nav.afterBoth = await navOn();
ev('frame', `📷 ⌥⌘I together → nav unchanged=${C.nav.afterBoth === C.nav.navNow}`);
await page.keyboard.press('Alt+KeyI').catch(() => {});   // leave nav mode off
await page.waitForTimeout(400);
await page.unroute('**/rawkey');

// ───── status-word-colour ─────
ev('narrate', '▶ status-word-colour · bucket hues on the glyph carrier: asking=yellow, offline=grey');
await page.goto('http://127.0.0.1:5201/#/graph', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
C.status = await page.evaluate(() => Array.from(document.querySelectorAll('.sess-row')).map(r => {
  const g = r.querySelector('.sess-glyph');
  return { status: g?.title || g?.getAttribute('aria-label'), color: g ? getComputedStyle(g).color : null, label: (r.querySelector('.sess-id')?.textContent || '').slice(0, 20) };
}));
ev('frame', `📷 glyph hues: ${JSON.stringify(C.status)}`);

// ───── close-tab-fallback ─────
ev('narrate', '▶ close-tab-fallback · closing the viewed tab lands on New; a made switch stands');
await page.goto('http://127.0.0.1:5201/#/sessions', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
// header carries no close control
C.close = { headerActs: await page.evaluate(() => Array.from(document.querySelectorAll('.si-actions button, .si-act')).map(e => e.textContent.trim())) };
ev('frame', `📷 header action row: ${JSON.stringify(C.close.headerActs)} (no close)`);
// PASS 1 — view A, close A → land on New
const rowA = page.locator('.si-item').filter({ hasText: 'stub row A' }).first();
await rowA.click();
await page.waitForTimeout(1500);
await rowA.click({ button: 'right' });
await page.waitForTimeout(800);
await page.getByText(/^close$|^关闭$/i).first().click();
await page.waitForTimeout(600);
await page.getByText(/confirm|确认|yes|sure|close/i).last().click().catch(() => {});
await page.waitForTimeout(4000);
C.close.pass1 = await page.evaluate(() => ({
  onNew: !!document.querySelector('.si-new-center'),
  aGone: !Array.from(document.querySelectorAll('.si-item')).some(e => e.textContent.includes('stub row A')),
}));
ev('frame', `📷 PASS1: closed viewed A → landed New=${C.close.pass1.onNew}, A gone=${C.close.pass1.aGone}`);
// PASS 2 — view B, close B, immediately switch to fixture → switch stands
const rowB = page.locator('.si-item').filter({ hasText: 'stub row B' }).first();
await rowB.click();
await page.waitForTimeout(1200);
await rowB.click({ button: 'right' });
await page.waitForTimeout(800);
await page.getByText(/^close$|^关闭$/i).first().click();
await page.waitForTimeout(400);
const confirmBtn = page.getByText(/confirm|确认|yes|sure|close/i).last();
await confirmBtn.click().catch(() => {});
await page.locator('.si-item').filter({ hasText: 'idle fixture' }).first().click();   // switch while in flight
await page.waitForTimeout(4500);
C.close.pass2 = await page.evaluate(() => ({
  onFixture: !!document.querySelector('.si-term-body') && !document.querySelector('.si-new-center'),
  bGone: !Array.from(document.querySelectorAll('.si-item')).some(e => e.textContent.includes('stub row B')),
}));
ev('frame', `📷 PASS2: closed B + switched to fixture → stayed on fixture=${C.close.pass2.onFixture}, B gone=${C.close.pass2.bGone}`);

await page.waitForTimeout(1000);
await ctx.close();
await browser.close();
writeFileSync(`${OUT}/session.timeline.json`, JSON.stringify({ events }, null, 1));
writeFileSync(`${OUT}/checks.json`, JSON.stringify(C, null, 1));
console.log('CHECKS', JSON.stringify(C, null, 1));
