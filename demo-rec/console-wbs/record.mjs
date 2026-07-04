// window-bounded-scroll: SessionWindow capped ~80vh, clears the stats strip, overflow scrolls to the last row.
import pkg from '/root/node_modules/playwright-core/index.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const { chromium } = pkg;
const OUT = '/root/spexcode/.worktrees/session-6b36/demo-rec/console-wbs';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome', args: ['--no-sandbox'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 540 }, recordVideo: { dir: OUT, size: { width: 1280, height: 540 } } });
const page = await ctx.newPage();
const t0 = Date.now();
const events = [];
const ev = (k, l) => { events.push({ atMs: Date.now() - t0, kind: k, label: l }); console.log(`[${((Date.now()-t0)/1000).toFixed(1)}s] ${l}`); };
const C = {};

ev('narrate', '▶ window-bounded-scroll · the SessionWindow glance is capped ~80vh, clears the stats strip, overflow scrolls');
await page.goto('http://127.0.0.1:5201/#/graph', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5500);

C.geom = await page.evaluate(() => {
  const win = document.querySelector('.sesswin');
  const stats = document.querySelector('.board-stats');
  const wr = win?.getBoundingClientRect();
  const sr = stats?.getBoundingClientRect();
  return {
    vh: window.innerHeight,
    winHeight: wr ? Math.round(wr.height) : null,
    winBottom: wr ? Math.round(wr.bottom) : null,
    winPctOfVh: wr ? Math.round(wr.height / window.innerHeight * 100) : null,
    statsTop: sr ? Math.round(sr.top) : null,
    clearsStats: wr && sr ? wr.bottom <= sr.top : null,   // window bottom above the stats strip
    rowCount: win ? win.querySelectorAll('.sess-row').length : 0,
    scrollable: win ? win.scrollHeight > win.clientHeight + 1 : false,
    scrollHeight: win?.scrollHeight, clientHeight: win?.clientHeight,
  };
});
ev('frame', `📷 glance: height=${C.geom.winHeight}px (${C.geom.winPctOfVh}% vh), bottom=${C.geom.winBottom} vs stats.top=${C.geom.statsTop} clearsStats=${C.geom.clearsStats}, rows=${C.geom.rowCount}, scrollable=${C.geom.scrollable}`);
await page.screenshot({ path: `${OUT}/wbs-top.png` });

// scroll the window to its end, confirm the last row is reachable
C.scroll = await page.evaluate(() => {
  const win = document.querySelector('.sesswin');
  if (!win) return null;
  const before = win.scrollTop;
  win.scrollTop = win.scrollHeight;   // wheel to the end
  return { before, after: win.scrollTop, maxScroll: win.scrollHeight - win.clientHeight, reachedEnd: Math.abs(win.scrollTop - (win.scrollHeight - win.clientHeight)) < 2 };
});
await page.waitForTimeout(1200);
ev('frame', `📷 scrolled to end: scrollTop ${C.scroll?.before}→${C.scroll?.after} (max ${C.scroll?.maxScroll}), reachedEnd=${C.scroll?.reachedEnd}`);
// the last row now visible within the window viewport
C.lastRow = await page.evaluate(() => {
  const win = document.querySelector('.sesswin');
  const rows = win ? Array.from(win.querySelectorAll('.sess-row')) : [];
  const last = rows[rows.length - 1];
  if (!last) return null;
  const lr = last.getBoundingClientRect(), wr = win.getBoundingClientRect();
  return { lastLabel: last.textContent.trim().slice(0, 24), lastInView: lr.top >= wr.top - 1 && lr.bottom <= wr.bottom + 2 };
});
ev('frame', `📷 last row '${C.lastRow?.lastLabel}' in view after scroll = ${C.lastRow?.lastInView}`);
await page.screenshot({ path: `${OUT}/wbs-scrolled.png` });

await page.waitForTimeout(1000);
await ctx.close();
await browser.close();
writeFileSync(`${OUT}/session.timeline.json`, JSON.stringify({ events }, null, 1));
writeFileSync(`${OUT}/checks.json`, JSON.stringify(C, null, 1));
console.log('CHECKS', JSON.stringify(C, null, 1));
