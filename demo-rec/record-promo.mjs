// Tight promo cut: circle → short remark with @new → dispatch echo → marker seek → A/B.
// No long typing, no dead air. Single scenario, ~30s.
import pkg from '/root/node_modules/playwright-core/index.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const { chromium } = pkg;

const OUT = '/root/spexcode/.worktrees/session-6b36/demo-rec/promo';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: '/root/.cache/ms-playwright/chromium-1217/chrome-linux64/chrome',
  args: ['--no-sandbox'],
});
const ctx = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  recordVideo: { dir: OUT, size: { width: 1600, height: 1000 } },
});
const page = await ctx.newPage();
const t0 = Date.now();
const mark = (l) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${l}`);
const checks = {};

// pre-warm OFF-CAMERA state as little as possible: land directly filtered
await page.goto('http://127.0.0.1:5201/#/evals', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2600);
await page.locator('.ef-stale').click();
await page.waitForTimeout(400);
await page.locator('[class*=chip]').filter({ hasText: /^video$/ }).first().click();
await page.waitForTimeout(500);
mark('feed ready');

await page.locator('.ef-row').filter({ hasText: 'video-plays-in-eval-tab' }).first().click();
await page.locator('.an-video').waitFor({ timeout: 10000 });
await page.waitForTimeout(900);
mark('workspace open');

// play a beat
await page.evaluate(() => { const v = document.querySelector('.an-video'); v.muted = true; v.play(); });
await page.waitForTimeout(1300);

// existing marker → seek
await page.locator('.an-mk').first().click();
await page.waitForTimeout(1100);
mark('marker seek');

// circle a region (quick, smooth)
const stage = await page.locator('.an-video').boundingBox();
const sx = stage.x + stage.width * 0.32, sy = stage.y + stage.height * 0.34;
const ex = stage.x + stage.width * 0.63, ey = stage.y + stage.height * 0.66;
await page.mouse.move(sx, sy); await page.mouse.down();
for (let i = 1; i <= 8; i++) { await page.mouse.move(sx + (ex - sx) * i / 8, sy + (ey - sy) * i / 8); await page.waitForTimeout(35); }
await page.mouse.up();
mark('circled');
// wait for prefill
let prefill = '';
for (let i = 0; i < 10; i++) { await page.waitForTimeout(600); prefill = await page.evaluate(() => document.querySelector('.an-rail-compose .fv-textarea')?.value || ''); if (prefill) break; }
checks.prefill = prefill.split('\n')[0];
mark('prefill: ' + checks.prefill);

// short remark WITH @new — fast typing, no dawdling
const ta = page.locator('.an-rail-compose .fv-textarea');
await ta.click();
await page.keyboard.press('Control+End');
await ta.type('这里该修 @new', { delay: 30 });
await page.waitForTimeout(300);
await page.keyboard.press('Escape').catch(() => {});   // dismiss the @-autocomplete menu if open
await page.waitForTimeout(200);
await page.locator('.an-rail-compose .fv-send').click();
mark('sent with @new');

// poll for the dispatch echo flash + the new marker
let echo = '';
mark('CUT-START');   // post-edit: cut from here …
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(400);
  echo = await page.evaluate(() => document.querySelector('.fv-notice')?.textContent || '');
  if (echo) break;
}
mark('CUT-END');     // … to here (echo just appeared)
checks.echo = echo.slice(0, 120);
checks.markers = await page.locator('.an-mk').count();
mark(`echo: ${checks.echo}`);
await page.waitForTimeout(1200);

// new marker → seek back to the circled moment
await page.locator('.an-mk').last().click();
await page.waitForTimeout(1100);
mark('new marker seek');

// A/B flip
await page.locator('.an-ab-pip').first().click();
await page.waitForTimeout(1200);
await page.locator('.an-ab-pip').last().click();
await page.waitForTimeout(1300);
mark('A/B flipped');

await ctx.close();
await browser.close();
writeFileSync(`${OUT}/checks.json`, JSON.stringify(checks, null, 1));
console.log('CHECKS', JSON.stringify(checks));
