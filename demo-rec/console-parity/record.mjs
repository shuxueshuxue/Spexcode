// board-command-parity on a REVIEW-state fixture (19e82e57): action-row colours + / menu + /proof + /nav.
import pkg from '/root/node_modules/playwright-core/index.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const { chromium } = pkg;
const OUT = '/root/spexcode/.worktrees/session-6b36/demo-rec/console-parity';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, recordVideo: { dir: OUT, size: { width: 1600, height: 1000 } } });
const page = await ctx.newPage();
const t0 = Date.now();
const events = [];
const ev = (k, l) => { events.push({ atMs: Date.now() - t0, kind: k, label: l }); console.log(`[${((Date.now()-t0)/1000).toFixed(1)}s] ${l}`); };
const C = {};

await page.goto('http://127.0.0.1:5201/#/sessions', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
for (let i = 0; i < 2; i++) { await page.keyboard.press('Escape'); await page.waitForTimeout(250); }
ev('narrate', '▶ board-command-parity · text-only coloured action row (nav yellow, merge green), the / menu, /proof→tab, /nav');
await page.locator('.si-item').filter({ hasText: /parity stub online.review/i }).first().click();
await page.waitForTimeout(2500);

// (1) action row: text-only, no glyph/emoji, nav yellow + merge green, no proof button
C.actions = await page.evaluate(() => Array.from(document.querySelectorAll('.si-act.board, .si-actions .si-act')).map(b => ({
  text: b.textContent.trim(), color: getComputedStyle(b).color, cls: b.className,
})));
C.leftTabs = await page.evaluate(() => Array.from(document.querySelectorAll('.si-tab')).map(e => e.textContent.trim()));
ev('frame', `📷 action row = ${JSON.stringify(C.actions)}; left tabs = ${JSON.stringify(C.leftTabs)}`);

// (2) the / menu — board commands lead, coloured, /exit deduped once, capitalised
const dock = page.locator('.si-bottom textarea');
if (await dock.count() && !(await dock.first().isDisabled())) {
  await dock.click();
  await dock.type('/', { delay: 60 });
  await page.waitForTimeout(1200);
  C.slashMenu = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('.mention-menu *, [class*=cmd-menu] *, [class*=slash] *')).filter(e => e.childElementCount === 0 && e.textContent.trim());
    return rows.slice(0, 14).map(e => ({ t: e.textContent.trim().slice(0, 40), color: getComputedStyle(e).color }));
  });
  ev('frame', `📷 / menu rows = ${JSON.stringify(C.slashMenu)}`);
  // narrow to /exit — must appear exactly once (board's coloured row, not CC's twin)
  await dock.type('exit', { delay: 60 });
  await page.waitForTimeout(1000);
  C.exitMenu = await page.evaluate(() => Array.from(document.querySelectorAll('.mention-menu *, [class*=cmd-menu] *, [class*=slash] *')).filter(e => e.childElementCount === 0 && /exit/i.test(e.textContent)).map(e => e.textContent.trim().slice(0, 50)));
  C.exitCount = C.exitMenu.filter(t => /^\/?exit/i.test(t)).length;
  ev('frame', `📷 /exit menu entries = ${JSON.stringify(C.exitMenu)} (board row appears once)`);
  // clear the draft
  await page.evaluate(() => { const t = document.querySelector('.si-bottom textarea'); const s = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; s.call(t, ''); t.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(400);
  // (3) /proof → Eval/Proof tab
  await dock.click();
  await dock.type('/proof', { delay: 50 });
  await page.keyboard.press('Escape');   // dismiss menu so Enter dispatches
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  C.proof = await page.evaluate(() => ({
    activeTab: document.querySelector('.si-tab.on')?.textContent.trim(),
    termHidden: getComputedStyle(document.querySelector('.si-term-body') || document.body).display === 'none',
    proofLineInPane: /\/proof/.test(document.querySelector('.si-term-body')?.innerText || ''),
  }));
  ev('frame', `📷 /proof typed → active tab='${C.proof.activeTab}' termHidden=${C.proof.termHidden} noProofLineDispatched=${!C.proof.proofLineInPane}`);
  // back to terminal
  await page.locator('.si-tab').first().click();
  await page.waitForTimeout(1000);
  // (4) /nav → nav mode + button .on
  await dock.click();
  await dock.type('/nav', { delay: 50 });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1200);
  C.nav = await page.evaluate(() => ({
    navBtnOn: !!document.querySelector('.si-act.nav.on, .si-act.board.nav.on'),
    navIndicator: /nav/i.test(document.querySelector('.si-bottom')?.innerText || '') || !!document.querySelector('[class*=nav-ind]'),
    navLineInPane: /\/nav/.test(document.querySelector('.si-term-body')?.innerText || ''),
  }));
  ev('frame', `📷 /nav typed → navBtnOn=${C.nav.navBtnOn} indicator=${C.nav.navIndicator} noNavLineDispatched=${!C.nav.navLineInPane}`);
  // toggle nav off via the button
  await page.locator('.si-act.nav, .si-act.board.nav').first().click().catch(() => {});
  await page.waitForTimeout(600);
}
await page.screenshot({ path: `${OUT}/parity.png` });
await page.waitForTimeout(800);
await ctx.close();
await browser.close();
writeFileSync(`${OUT}/session.timeline.json`, JSON.stringify({ events }, null, 1));
writeFileSync(`${OUT}/checks.json`, JSON.stringify(C, null, 1));
console.log('CHECKS', JSON.stringify(C, null, 1));
