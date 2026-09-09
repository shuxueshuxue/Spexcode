// detail-rail.e2e.mjs — the [[review-chrome]]/[[issues-view]] detail-rail batch driver, run against a
// live backend through the real dashboard (BASE env, default the worktree vite):
//   1. detail-side-rail-sticky   — sticky rail on desktop over a long Issues thread, plain flow at 390
//   2. detail-metadata-primitive — ONE SideValue rail primitive, explicit type labels, en/zh
// Prints a transcript of every check; saves screenshots and whole-journey videos under OUT.
import { pathToFileURL } from 'node:url'
import { mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const BASE = process.env.BASE || 'http://localhost:5176'
const OUT = process.env.OUT || '/tmp/detail-rail-e2e'
mkdirSync(OUT, { recursive: true })
const { chromium } = await import(pathToFileURL(PW).href)

const LONG_ISSUE = 'global-drift-remediation-bounded-backlog-axis-re'   // local, ~48 replies: main column ≫ viewport
const LOCAL_ISSUE = 'pure-read-only-review-sessions-have-no-honest-st' // local, session-UUID by, node link, no labels
const NODE_REF = 'stop-gate'                                            // LOCAL_ISSUE's one spec-node ref

let pass = 0, fail = 0
const results = []
const check = (name, ok, detail = '') => {
  results.push(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  console.log(results.at(-1))
  ok ? pass++ : fail++
}

const browser = await chromium.launch()
const settle = (p, ms = 700) => p.waitForTimeout(ms)
const railProbe = (p) => p.evaluate(() => {
  const side = document.querySelector('.ds-side')
  const cs = getComputedStyle(side)
  return { position: cs.position, maxHeight: cs.maxHeight, top: side.getBoundingClientRect().top, bottom: side.getBoundingClientRect().bottom }
})
// each detail opens in a FRESH document: a hash-only goto keeps the previous issue mounted in a hidden
// viewhost (kept-alive document tabs), which would leave document.querySelector on the hidden page.
// a long thread is "loaded" once its replies are in the DOM, not merely once the shell mounted.
const openIssue = async (p, id, ms = 700) => {
  await p.goto('about:blank')
  await p.goto(`${BASE}/#/issues/${id}`)
  await p.waitForSelector('.ds-side')
  if (id === LONG_ISSUE) await p.waitForSelector('.fv-reply')
  await settle(p, ms)
}

// ---------- 1440 journey (video): sticky + metadata ----------
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } })
const p = await ctx.newPage()

// — sticky: long issue thread —
await openIssue(p, LONG_ISSUE, 1200)
check('issue rail computed position sticky', (await railProbe(p)).position === 'sticky')
const stick = await p.evaluate(() => {
  const pg = document.querySelector('.ds-page')
  const side = document.querySelector('.ds-side')
  const scrollable = pg.scrollHeight - pg.clientHeight
  const head = document.querySelector('.ds-head')
  pg.scrollTop = 800
  return new Promise((res) => requestAnimationFrame(() => res({
    scrollable,
    // sticky pins against the .ds-page scrollport, which sits below the app's top chrome — measure in ITS frame
    railInset: side.getBoundingClientRect().top - pg.getBoundingClientRect().top,
    headGone: head.getBoundingClientRect().bottom < 0,
    nested: side.scrollHeight > side.clientHeight,
    railRight: side.getBoundingClientRect().right, pageRight: pg.getBoundingClientRect().right,
  })))
})
check('long main column actually scrolls', stick.scrollable > 500, `scrollable=${stick.scrollable}`)
check('rail pinned near scrollport top at scroll 800', stick.railInset >= 0 && stick.railInset <= 40, `inset=${stick.railInset}`)
check('header scrolls away normally (not overlapped, not fixed)', stick.headGone)
check('no nested scrollbar at 900h (rail shorter than viewport)', !stick.nested)
check('rail contained in page (no overlay drift)', stick.railRight <= stick.pageRight + 1)
await p.screenshot({ path: `${OUT}/b-sticky-1440-scrolled.png` })
// scroll through the full height — the docked composer stays in its column, rail stays pinned
const stickEnd = await p.evaluate(() => {
  const pg = document.querySelector('.ds-page')
  pg.scrollTop = pg.scrollHeight
  return new Promise((res) => requestAnimationFrame(() => {
    const side = document.querySelector('.ds-side').getBoundingClientRect()
    const compose = document.querySelector('.ds-compose')?.getBoundingClientRect() || null
    const overlap = compose ? !(side.right <= compose.left || compose.right <= side.left) : false
    res({ railInset: side.top - pg.getBoundingClientRect().top, hasComposer: !!compose, overlapsComposer: overlap })
  }))
})
check('issue detail docks a composer at the main column foot', stickEnd.hasComposer)
check('at page bottom the rail is still pinned and beside (never over) the docked composer', stickEnd.railInset >= 0 && stickEnd.railInset <= 40 && !stickEnd.overlapsComposer, `inset=${stickEnd.railInset} overlap=${stickEnd.overlapsComposer}`)

// — sticky: short issue detail (same shell regardless of thread length) —
await openIssue(p, LOCAL_ISSUE)
check('short issue rail sticky too (one DetailShell, no length fork)', (await railProbe(p)).position === 'sticky')

// — metadata (en, 1440): issue detail rail —
const issueRail = await p.evaluate(() => {
  const secs = [...document.querySelectorAll('.ds-side-sec')].map((s) => ({
    label: s.querySelector('.ds-side-label')?.textContent,
    values: [...s.querySelectorAll('.ds-val')].map((v) => ({
      tag: v.tagName, text: v.querySelector('.ds-val-text')?.textContent, tip: v.getAttribute('data-tip'), href: v.getAttribute('href'), cls: v.className,
      dot: !!v.querySelector('.fv-originator-dot'),
      truncated: (() => { const t = v.querySelector('.ds-val-text'); return t ? t.scrollWidth > t.clientWidth + 1 : false })(),
      cs: (() => { const t = v.querySelector('.ds-val-text'); const c = t && getComputedStyle(t); return c ? { minWidth: c.minWidth, textOverflow: c.textOverflow, whiteSpace: c.whiteSpace } : null })(),
    })),
  }))
  const strays = [...document.querySelectorAll('.ds-side .fv-chip, .ds-side .fv-by, .ds-side .fv-link, .ds-side .ds-side-line, .ds-side .fv-originator-who')]
  const nonPrimitive = [...document.querySelectorAll('.ds-side-body > *')].filter((el) => !el.classList.contains('ds-val'))
  return { secs, strayCount: strays.length, nonPrimitiveCount: nonPrimitive.length }
})
const idSec = issueRail.secs[0]
check('issue identity row FIRST under a localized Issue label', idSec?.label === 'issue' && idSec.values[0]?.text === LOCAL_ISSUE, JSON.stringify(idSec?.label))
check('long slug ellipsizes inside the rail, full slug on tooltip', idSec.values[0]?.truncated === true && idSec.values[0]?.tip === LOCAL_ISSUE)
check('value contract min-width:0 / ellipsis / nowrap', JSON.stringify(idSec.values[0]?.cs) === JSON.stringify({ minWidth: '0px', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }))
const bySec = issueRail.secs.find((s) => s.label === 'opened by')
const by = bySec?.values[0]
check('local originator is a liveness chip (button when live, span when offline) wearing SideValue', (by?.tag === 'BUTTON' || by?.tag === 'SPAN') && /\bds-val\b/.test(by?.cls || '') && /\bfv-originator\b/.test(by?.cls || '') && by?.dot === true, by?.cls)
check('originator chip: session UUID as text, full id kept on the tooltip', /^[0-9a-f-]{36}$/.test(by?.text || '') && (by?.tip || '').includes(by?.text || '\0'))
const nodeSec = issueRail.secs.find((s) => s.label === 'spec nodes')
check('spec-node refs under their localized label, REAL anchors into the graph route', nodeSec?.values.every((v) => v.tag === 'A' && /^#\/graph\//.test(v.href || '')) && nodeSec.values[0]?.text === NODE_REF, JSON.stringify(nodeSec?.values.map((v) => [v.tag, v.href])))
check('no parallel inline variants in the rail (fv-chip/fv-by/fv-link/ds-side-line gone)', issueRail.strayCount === 0)
check('every rail value rides the ONE primitive', issueRail.nonPrimitiveCount === 0, `nonPrimitive=${issueRail.nonPrimitiveCount}`)
await (await p.$('.ds-side')).screenshot({ path: `${OUT}/b-issue-rail-1440-en.png` })

// node ref click focuses the graph (real behavior), Back returns
const beforeHash = await p.evaluate(() => location.hash)
await p.click('.ds-side-sec:has(.ds-side-label:text("spec nodes")) .ds-val')
await settle(p, 400)
const afterHash = await p.evaluate(() => location.hash)
check('node ref click navigates to the graph', afterHash !== beforeHash && afterHash === `#/graph/${NODE_REF}`, afterHash)
await p.goBack(); await settle(p, 400)
check('Back returns to the issue detail', (await p.evaluate(() => location.hash)).includes(LOCAL_ISSUE))

await ctx.close()   // flush the 1440 journey video

// ---------- zh (1440): localized labels, same primitive ----------
const zctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const z = await zctx.newPage()
await z.addInitScript(() => localStorage.setItem('spexcode.lang', 'zh'))
await openIssue(z, LOCAL_ISSUE)
const zhIssue = await z.evaluate(() => [...document.querySelectorAll('.ds-side-label')].map((l) => l.textContent))
check('zh issue rail labels localized (议题/存储/发起者/规格节点)', ['议题', '存储', '发起者', '规格节点'].every((l) => zhIssue.includes(l)), JSON.stringify(zhIssue))
await (await z.$('.ds-side')).screenshot({ path: `${OUT}/b-issue-rail-1440-zh.png` })
await openIssue(z, LONG_ISSUE, 900)
const zhLong = await z.evaluate(() => ({
  labels: [...document.querySelectorAll('.ds-side-label')].map((l) => l.textContent),
  nodeCount: document.querySelectorAll('.ds-side-sec .ds-val[href^="#/graph/"]').length,
  ok: (() => { const t = [...document.querySelectorAll('.ds-val-text')]; return t.length > 0 && t.every((el) => getComputedStyle(el).textOverflow === 'ellipsis') })(),
}))
check('zh long-thread rail: 规格节点 + several node anchors + primitive intact', zhLong.labels.includes('规格节点') && zhLong.nodeCount >= 2 && zhLong.ok, JSON.stringify(zhLong))
await zctx.close()

// ---------- 390 journey (video): plain flow, no overflow, primitive holds ----------
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, recordVideo: { dir: OUT, size: { width: 390, height: 844 } } })
const m = await mctx.newPage()
await openIssue(m, LONG_ISSUE, 1000)
const m1 = await m.evaluate(() => {
  const side = document.querySelector('.ds-side')
  const main = document.querySelector('.ds-main')
  document.querySelector('.ds-page').scrollTop = 400
  return new Promise((res) => requestAnimationFrame(() => res({
    position: getComputedStyle(side).position,
    sideFirst: side.getBoundingClientRect().top < main.getBoundingClientRect().top,
    railContained: side.getBoundingClientRect().right <= innerWidth + 1,
    noSilentClip: getComputedStyle(side).overflowX !== 'visible' || side.getBoundingClientRect().right <= innerWidth + 1,
    docW: document.documentElement.scrollWidth, pageW: document.querySelector('.ds-page').scrollWidth,
    railScrolledAway: side.getBoundingClientRect().bottom < 0 || document.querySelector('.ds-page').scrollTop > 0,
  })))
})
check('390 long issue: rail static, metadata-before-content, scrolls WITH the document', m1.position === 'static' && m1.sideFirst && m1.railScrolledAway)
check('390 long issue: rail is contained (document width alone is insufficient)', m1.railContained && m1.noSilentClip && m1.docW <= 390 && m1.pageW <= 390, `railContained=${m1.railContained} noSilentClip=${m1.noSilentClip} doc=${m1.docW} page=${m1.pageW}`)
await m.screenshot({ path: `${OUT}/b-390-long-issue.png` })
await openIssue(m, LOCAL_ISSUE)
const m2 = await m.evaluate(() => {
  const t = document.querySelector('.ds-side-sec .ds-val-text')
  // the contract is shrink-with-ellipsis WHEN the value exceeds its column — at 390 the full-width
  // column may simply fit the slug; what must hold is containment: no page widening, value inside.
  return { docW: document.documentElement.scrollWidth, contained: t.getBoundingClientRect().right <= 390, fitsOrTruncates: t.scrollWidth <= t.clientWidth + 1 || getComputedStyle(t).textOverflow === 'ellipsis', position: getComputedStyle(document.querySelector('.ds-side')).position }
})
check('390 issue: slug contained (fits or ellipsizes), rail static, no horizontal overflow', m2.docW <= 390 && m2.contained && m2.fitsOrTruncates && m2.position === 'static')
await m.screenshot({ path: `${OUT}/b-390-issue.png` })
await mctx.close()

await browser.close()
// name the videos deterministically for evidence filing
const vids = readdirSync(OUT).filter((f) => f.endsWith('.webm')).sort()
if (vids[0]) renameSync(join(OUT, vids[0]), join(OUT, 'b-journey-1440.webm'))
if (vids[1]) renameSync(join(OUT, vids[1]), join(OUT, 'b-journey-390.webm'))

console.log(`\n${pass}/${pass + fail} checks passed${fail ? ` — ${fail} FAILED` : ''}`)
console.log(`evidence in ${OUT}`)
if (fail) process.exit(1)
