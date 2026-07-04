// Golden-path e2e recording for the video-eval annotator demo (promo + dogfood).
// Emits: demo-rec/session.webm + demo-rec/session.timeline.json (e2e-review skill emitter format).
// Scenario 1: video-plays-in-eval-tab (node eval tab, NodeView overlay)
// Scenario 2: annotate-seek-circle-file (EventDetail workspace: circle → remark → marker seek → A/B)
import pkg from '/root/node_modules/playwright-core/index.js';
import { writeFileSync, mkdirSync } from 'node:fs';
const { chromium } = pkg;

const OUT = '/root/spexcode/.worktrees/session-6b36/demo-rec';
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
const events = [];
const ev = (kind, label) => { events.push({ atMs: Date.now() - t0, kind, label }); console.log(`[${Date.now() - t0}ms] ${label}`); };
const checks = {};

// ───────── scenario 1: video-plays-in-eval-tab ─────────
ev('narrate', '▶ video-plays-in-eval-tab · inline video evidence in the node eval tab');
await page.goto('http://127.0.0.1:5201/#/graph', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3500);
ev('frame', '📷 board');
await page.locator('.react-flow__node').filter({ hasText: 'spec-yatsu' }).first().click();
await page.waitForTimeout(1800);
await page.locator('.react-flow__node').filter({ hasText: 'video-evidence' }).first().click();
await page.waitForTimeout(1500);
ev('frame', '📷 focus video-evidence — scenario row in the side panel');
await page.locator('.fp-scenario').first().click();
await page.waitForTimeout(2200);
ev('frame', '📷 eval work pane opens on the scenario');
// the row mounts async — WAIT first, never click (a click toggles the open row closed)
await page.locator('video.eval-video').waitFor({ timeout: 12000 }).catch(async () => {
  await page.locator('.pane-eval .eval-scenario').first().click({ timeout: 3000 }).catch(() => {});
  await page.locator('video.eval-video').waitFor({ timeout: 6000 }).catch(() => {});
});
ev('frame', '📷 video reading expanded in the eval pane');
checks.s1 = await page.evaluate(async () => {
  const vid = document.querySelector('video.eval-video');
  if (!vid) return { video: false };
  vid.muted = true; await vid.play().catch(() => {});
  await new Promise(r => setTimeout(r, 1200));
  const r = await fetch(vid.currentSrc, { headers: { Range: 'bytes=0-99' } });
  return {
    video: true, cls: vid.className, srcIsBlobRoute: vid.currentSrc.includes('/api/yatsu/blob/'),
    contentType: r.headers.get('content-type'), rangeStatus: r.status,
    readyState: vid.readyState, currentTime: vid.currentTime, paused: vid.paused,
    siblingImgs: document.querySelectorAll('img[src*="/api/yatsu/blob/"]').length,
  };
});
ev('frame', `📷 video playing (readyState=${checks.s1.readyState} t=${(checks.s1.currentTime || 0).toFixed(2)}s ct=${checks.s1.contentType})`);
await page.waitForTimeout(800);
await page.keyboard.press('Escape');
await page.waitForTimeout(800);

// ───────── scenario 2: annotate-seek-circle-file ─────────
ev('narrate', '▶ annotate-seek-circle-file · circle → anchored remark → marker seek → A/B');
await page.goto('http://127.0.0.1:5201/#/evals', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(2500);
ev('frame', '📷 evals feed (video filter is EMPTY — no fresh video eval yet)');
await page.locator('.ef-stale').click();
await page.waitForTimeout(600);
await page.locator('[class*=chip]').filter({ hasText: /^video$/ }).first().click();
await page.waitForTimeout(1000);
const vidRows = page.locator('.ef-row').filter({ hasText: 'video-plays-in-eval-tab' });
console.log('matching rows:', await vidRows.count());
await vidRows.first().click();
await page.waitForTimeout(2500);
await page.locator('.an-video').waitFor({ timeout: 10000 }).catch(async () => {
  console.log('NO .an-video — detail state:', await page.evaluate(() => document.querySelector('.an-detail')?.className + ' | ' + (document.querySelector('.an-stage')?.innerHTML || '').slice(0, 150)));
});
ev('frame', '📷 workspace: stage + review track + docked composer');
checks.s2open = await page.evaluate(() => ({
  video: !!document.querySelector('.an-video'),
  composerVisible: !!document.querySelector('.an-rail-compose .fv-textarea')?.offsetParent,
  markers: document.querySelectorAll('.an-mk').length,
  abPips: document.querySelectorAll('.an-ab-pip').length,
}));

// play a moment
await page.evaluate(() => { const v = document.querySelector('.an-video'); if (v) { v.muted = true; v.play(); } });
await page.waitForTimeout(1400);
ev('frame', '📷 playing — playhead advances the review track');

// click the existing marker → seek + rail highlight
const mkCount0 = checks.s2open.markers;
if (mkCount0 > 0) {
  await page.locator('.an-mk').first().click({ timeout: 5000 });
  await page.waitForTimeout(1200);
  checks.markerSeek = await page.evaluate(() => ({
    t: document.querySelector('.an-video')?.currentTime,
    selectedRemark: !!document.querySelector('.an-rail .remark.on, .an-rail [class*="sel"], .an-rail [class*="on"]'),
  }));
  ev('frame', `📷 marker click → seek t=${(checks.markerSeek.t || 0).toFixed(2)}s + rail highlight`);
}

// drag-circle a region on the paused frame
const stage = await page.locator('.an-video').boundingBox();
const sx = stage.x + stage.width * 0.30, sy = stage.y + stage.height * 0.35;
const exx = stage.x + stage.width * 0.62, eyy = stage.y + stage.height * 0.68;
await page.mouse.move(sx, sy);
await page.mouse.down();
for (let i = 1; i <= 12; i++) {
  await page.mouse.move(sx + (exx - sx) * i / 12, sy + (eyy - sy) * i / 12);
  await page.waitForTimeout(45);
}
await page.waitForTimeout(300);
await page.mouse.up();
for (let i = 0; i < 10; i++) {
  await page.waitForTimeout(1000);
  const got = await page.evaluate(() => document.querySelector('.an-rail-compose .fv-textarea')?.value || '');
  if (got) break;
}
checks.circle = await page.evaluate(() => {
  const ta = document.querySelector('.an-rail-compose .fv-textarea');
  return {
    composerPrefill: ta ? ta.value : null,
    frames: document.querySelectorAll('.fv-frames .fv-frame').length,
    paused: document.querySelector('.an-video')?.paused,
  };
});
ev('frame', `📷 drag-circle → composer prefilled (${(checks.circle.composerPrefill || '').split('\n')[0]}) + frame captured`);

// type the remark under the anchor line and send
const ta = page.locator('.an-rail-compose .fv-textarea');
await ta.click();
await page.keyboard.press('Control+End');
await ta.type('宣传稿 demo:圈选一处细节,remark 连帧图一起进 eval 线程 — filed by the promo session (dogfood)', { delay: 18 });
await page.waitForTimeout(600);
ev('frame', '📷 remark typed in the docked composer (video still on screen — no scroll)');
await page.locator('.an-rail-compose .fv-send').click();
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(1000);
  if (await page.locator('.an-mk').count() >= 2) break;
}
checks.sent = await page.evaluate(() => ({
  markers: document.querySelectorAll('.an-mk').length,
  remarks: document.querySelectorAll('.an-rail-list .remark, .an-rail-list [class*=remark]').length,
  anchors: document.querySelectorAll('.fv-anchor').length,
}));
ev('frame', `📷 sent → review track has ${checks.sent.markers} markers now`);

// click the newest marker → seek roundtrip
if (checks.sent.markers > 0) {
  await page.locator('.an-mk').last().click();
  await page.waitForTimeout(1200);
  ev('frame', '📷 new marker click → seeks to the circled moment');
}

// A/B history flip
if (checks.s2open.abPips > 1) {
  await page.locator('.an-ab-pip').first().click();
  await page.waitForTimeout(1500);
  ev('frame', '📷 A/B strip → flip to an earlier reading (fail/pass history in place)');
  await page.locator('.an-ab-pip').last().click();
  await page.waitForTimeout(1500);
  ev('frame', '📷 A/B strip → back to latest');
}
await page.waitForTimeout(1200);

await ctx.close();
await browser.close();
writeFileSync(`${OUT}/session.timeline.json`, JSON.stringify({ events }, null, 1));
writeFileSync(`${OUT}/checks.json`, JSON.stringify(checks, null, 1));
console.log('CHECKS', JSON.stringify(checks, null, 1));
