// close-tab-fallback complete retake: PASS1 on stub C, PASS2 on stub D (fixture untouched).
import pkg from '/root/node_modules/playwright-core/index.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const { chromium } = pkg;
const OUT = '/root/spexcode/.worktrees/session-6b36/demo-rec/console2b';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, recordVideo: { dir: OUT, size: { width: 1600, height: 1000 } } });
const page = await ctx.newPage();
page.on('dialog', d => d.accept());
const t0 = Date.now();
const events = [];
const ev = (k, l) => { events.push({ atMs: Date.now() - t0, kind: k, label: l }); console.log(`[${((Date.now()-t0)/1000).toFixed(1)}s] ${l}`); };
const C = {};

await page.goto('http://127.0.0.1:5201/#/sessions', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
for (let i = 0; i < 2; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(300); }
ev('narrate', '▶ close-tab-fallback · removal decides the landing: viewed tab → New; a made switch stands');
C.headerActs = await page.evaluate(() => Array.from(document.querySelectorAll('.si-actions button, .si-act')).map(e => e.textContent.trim()));
ev('frame', `📷 header action row = ${JSON.stringify(C.headerActs)} — no close control`);

const closeVia = async (rowText) => {
  const row = page.locator('.si-item').filter({ hasText: rowText }).first();
  await row.click({ button: 'right' });
  await page.waitForTimeout(900);
  await page.locator('.sess-menu-item.danger').first().click();   // 'close' → opens confirm modal
  await page.waitForTimeout(800);
  // confirm modal: the danger button INSIDE .sess-confirm (not the menu item, which is gone)
  await page.locator('.sess-confirm .sess-rename-btn.danger').click({ timeout: 4000 });
  await page.waitForTimeout(600);
};

// PASS 1 — view C, close C → land on New
await page.locator('.si-item').filter({ hasText: 'stub row G' }).first().click();
await page.waitForTimeout(1500);
ev('frame', '📷 viewing E');
await closeVia('stub row G');
let eGone = false;
for (let i = 0; i < 15; i++) { await page.waitForTimeout(1000); eGone = await page.evaluate(() => !Array.from(document.querySelectorAll('.si-item')).some(e => e.textContent.includes('stub row G'))); if (eGone) break; }
C.pass1 = { eGone, onNew: await page.evaluate(() => !!document.querySelector('.si-new-center')) };
ev('frame', `📷 PASS1: closed viewed E → landed on New=${C.pass1.onNew}, E gone=${C.pass1.eGone}`);

// PASS 2 — view D, close D, immediately switch to fixture → the switch stands
await page.locator('.si-item').filter({ hasText: 'stub row H' }).first().click();
await page.waitForTimeout(1200);
ev('frame', '📷 viewing F');
await closeVia('stub row H');
await page.locator('.si-item').filter({ hasText: 'idle fixture' }).first().click();
let fGone = false;
for (let i = 0; i < 15; i++) { await page.waitForTimeout(1000); fGone = await page.evaluate(() => !Array.from(document.querySelectorAll('.si-item')).some(e => e.textContent.includes('stub row H'))); if (fGone) break; }
C.pass2 = { fGone, onFixture: await page.evaluate(() => !document.querySelector('.si-new-center') && !!document.querySelector('.si-term-body')) };
ev('frame', `📷 PASS2: closed F + switched to fixture → stayed=${C.pass2.onFixture}, F gone=${C.pass2.fGone}`);

await page.waitForTimeout(800);
await ctx.close();
await browser.close();
writeFileSync(`${OUT}/session.timeline.json`, JSON.stringify({ events }, null, 1));
writeFileSync(`${OUT}/checks.json`, JSON.stringify(C, null, 1));
console.log('CHECKS', JSON.stringify(C));
