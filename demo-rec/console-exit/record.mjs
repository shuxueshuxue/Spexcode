// exit-command-stops-keeps-worktree on a live idle reclaude session (dce0c72b).
import pkg from '/root/node_modules/playwright-core/index.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const { chromium } = pkg;
const OUT = '/root/spexcode/.worktrees/session-6b36/demo-rec/console-exit';
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
ev('narrate', '▶ exit-command-stops-keeps-worktree · /exit stops but keeps the row; relaunch resumes');
await page.locator('.si-item').filter({ hasText: 'exit-command fixture' }).first().click();
await page.waitForTimeout(2500);
C.before = await page.evaluate(() => ({
  termVisible: !!document.querySelector('.si-term-body')?.offsetParent,
  dockEnabled: document.querySelector('.si-bottom textarea') && !document.querySelector('.si-bottom textarea').disabled,
  rowThere: Array.from(document.querySelectorAll('.si-item')).some(e => e.textContent.includes('exit-command fixture')),
}));
ev('frame', `📷 before: live terminal, ❯ enabled=${C.before.dockEnabled}, row present=${C.before.rowThere}`);
// type exactly /exit, dismiss the / menu, Enter
const dock = page.locator('.si-bottom textarea');
await dock.click();
await dock.type('/exit', { delay: 60 });
await page.waitForTimeout(900);
// dismiss the completion menu so Enter dispatches, not completes
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.keyboard.press('Enter');
ev('frame', '📷 typed /exit + Enter (menu dismissed first)');
// poll for offline + relaunch panel
let done = false;
for (let i = 0; i < 15; i++) {
  await page.waitForTimeout(1200);
  const st = await page.evaluate(() => ({
    relaunch: /relaunch|offline|no live process/i.test(document.querySelector('.si-term-body')?.innerText || ''),
    dockDisabled: document.querySelector('.si-bottom textarea')?.disabled,
    rowThere: Array.from(document.querySelectorAll('.si-item')).some(e => e.textContent.includes('exit-command fixture')),
    onNew: !!document.querySelector('.si-new-center'),
    exitLineInPane: /\/exit/.test(document.querySelector('.si-term-body')?.innerText || ''),
  }));
  if (st.relaunch || st.dockDisabled) { C.after = st; done = true; break; }
  C.after = st;
}
ev('frame', `📷 after /exit: relaunchPanel=${C.after.relaunch} rowStays=${C.after.rowThere} notOnNew=${!C.after.onNew} noExitLineDispatched=${!C.after.exitLineInPane}`);
// resumability: click relaunch, confirm it comes back online on the same conversation
const relaunchBtn = page.locator('button').filter({ hasText: /relaunch|resume|重启|恢复/i }).first();
if (await relaunchBtn.count()) {
  await relaunchBtn.click();
  let back = false;
  for (let i = 0; i < 15; i++) { await page.waitForTimeout(1500); back = await page.evaluate(() => !!document.querySelector('.si-term-body')?.offsetParent && !document.querySelector('.si-bottom textarea')?.disabled); if (back) break; }
  C.resumed = back;
  ev('frame', `📷 clicked relaunch → back online (same worktree/conversation) = ${C.resumed}`);
}

await page.waitForTimeout(1000);
await ctx.close();
await browser.close();
writeFileSync(`${OUT}/session.timeline.json`, JSON.stringify({ events }, null, 1));
writeFileSync(`${OUT}/checks.json`, JSON.stringify(C, null, 1));
console.log('CHECKS', JSON.stringify(C, null, 1));
