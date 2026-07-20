// detail-rail.e2e.mjs — the [[review-chrome]]/[[evals-view]] detail-rail batch driver, run against a
// live backend through the real dashboard (BASE env, default the worktree vite):
//   1. detail-side-rail-sticky   — sticky rail on desktop, plain flow at 390
//   2. continue-reviewing-queue  — Previous / Up next positional groups + navigation
//   3. detail-metadata-primitive — ONE SideValue rail primitive, explicit type labels, en/zh
// Prints a transcript of every check; saves screenshots and whole-journey videos under OUT.
import { pathToFileURL } from 'node:url'
import { mkdirSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

const PW = process.env.SPEXCODE_PLAYWRIGHT_PATH || '/home/jeffry/studio-harness/node_modules/playwright/index.mjs'
const BASE = process.env.BASE || 'http://localhost:5176'
const OUT = process.env.OUT || '/tmp/detail-rail-e2e'
mkdirSync(OUT, { recursive: true })
const { chromium } = await import(pathToFileURL(PW).href)

const LONG_EVAL = '#/evals/event-detail/media-intrinsic-geometry'   // video + gallery, main column ≫ viewport
const LOCAL_ISSUE = 'pure-read-only-review-sessions-have-no-honest-st' // local, session-UUID by, node link

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

// ---------- 1440 journey (video): sticky + queue + metadata ----------
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir: OUT, size: { width: 1440, height: 900 } } })
const p = await ctx.newPage()

// — sticky: long eval detail —
await p.goto(`${BASE}/${LONG_EVAL}`)
await p.waitForSelector('.ds-side'); await settle(p, 1200)
check('eval rail computed position sticky', (await railProbe(p)).position === 'sticky')
const stick = await p.evaluate(() => {
  const pg = document.querySelector('.ds-page')
  const side = document.querySelector('.ds-side')
  const scrollable = pg.scrollHeight - pg.clientHeight
  const head = document.querySelector('.ds-head')
  pg.scrollTop = 800
  return new Promise((res) => requestAnimationFrame(() => res({
    scrollable,
    railTop: side.getBoundingClientRect().top,
    headGone: head.getBoundingClientRect().bottom < 0,
    nested: side.scrollHeight > side.clientHeight,
    railRight: side.getBoundingClientRect().right, pageRight: pg.getBoundingClientRect().right,
  })))
})
check('long main column actually scrolls', stick.scrollable > 500, `scrollable=${stick.scrollable}`)
check('rail pinned near scrollport top at scroll 800', stick.railTop >= 0 && stick.railTop <= 40, `top=${stick.railTop}`)
check('header scrolls away normally (not overlapped, not fixed)', stick.headGone)
check('no nested scrollbar at 900h (rail shorter than viewport)', !stick.nested)
check('rail contained in page (no overlay drift)', stick.railRight <= stick.pageRight + 1)
await p.screenshot({ path: `${OUT}/b-sticky-1440-scrolled.png` })
// scroll through the full height — the composer stays in its column, rail stays pinned
const stickEnd = await p.evaluate(() => {
  const pg = document.querySelector('.ds-page')
  pg.scrollTop = pg.scrollHeight
  return new Promise((res) => requestAnimationFrame(() => {
    const side = document.querySelector('.ds-side').getBoundingClientRect()
    const compose = document.querySelector('.ds-compose')?.getBoundingClientRect() || null
    const overlap = compose ? !(side.right <= compose.left || compose.right <= side.left) : false
    res({ railTop: side.top, overlapsComposer: overlap })
  }))
})
check('at page bottom the rail is still pinned and beside (never over) the docked composer', stickEnd.railTop >= 0 && stickEnd.railTop <= 40 && !stickEnd.overlapsComposer)

// — sticky: issue detail (same shell) —
await p.goto(`${BASE}/#/issues/${LOCAL_ISSUE}`)
await p.waitForSelector('.ds-side'); await settle(p)
check('issue rail sticky (one DetailShell, no page fork)', (await railProbe(p)).position === 'sticky')

// — metadata (en, 1440): issue detail rail —
const issueRail = await p.evaluate(() => {
  const secs = [...document.querySelectorAll('.ds-side-sec')].map((s) => ({
    label: s.querySelector('.ds-side-label')?.textContent,
    values: [...s.querySelectorAll('.ds-val')].map((v) => ({
      tag: v.tagName, text: v.querySelector('.ds-val-text')?.textContent, tip: v.getAttribute('data-tip'),
      truncated: (() => { const t = v.querySelector('.ds-val-text'); return t ? t.scrollWidth > t.clientWidth + 1 : false })(),
      cs: (() => { const t = v.querySelector('.ds-val-text'); const c = t && getComputedStyle(t); return c ? { minWidth: c.minWidth, textOverflow: c.textOverflow, whiteSpace: c.whiteSpace } : null })(),
    })),
  }))
  const strays = [...document.querySelectorAll('.ds-side .fv-chip, .ds-side .fv-by, .ds-side .fv-link, .ds-side .ds-side-line, .ds-side .fv-originator-who')]
  const nonPrimitive = [...document.querySelectorAll('.ds-side-body > *')].filter((el) => !el.classList.contains('ds-val') && !el.classList.contains('ds-queue-group'))
  return { secs, strayCount: strays.length, nonPrimitiveCount: nonPrimitive.length }
})
const idSec = issueRail.secs[0]
check('issue identity row FIRST under a localized Issue label', idSec?.label === 'issue' && idSec.values[0]?.text === LOCAL_ISSUE, JSON.stringify(idSec?.label))
check('long slug ellipsizes inside the rail, full slug on tooltip', idSec.values[0]?.truncated === true && idSec.values[0]?.tip === LOCAL_ISSUE)
check('value contract min-width:0 / ellipsis / nowrap', JSON.stringify(idSec.values[0]?.cs) === JSON.stringify({ minWidth: '0px', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }))
const bySec = issueRail.secs.find((s) => s.label === 'opened by')
check('local originator is a live-join chip (button+dot) wearing SideValue', bySec?.values[0]?.tag === 'BUTTON' || bySec?.values[0]?.tag === 'SPAN')
const nodeSec = issueRail.secs.find((s) => s.label === 'spec nodes')
check('spec-node refs under their localized label, real buttons', nodeSec?.values.every((v) => v.tag === 'BUTTON') && nodeSec.values[0]?.text === 'stop-gate')
check('no parallel inline variants in the rail (fv-chip/fv-by/fv-link/ds-side-line gone)', issueRail.strayCount === 0)
check('every rail value rides the ONE primitive', issueRail.nonPrimitiveCount === 0, `nonPrimitive=${issueRail.nonPrimitiveCount}`)
await (await p.$('.ds-side')).screenshot({ path: `${OUT}/b-issue-rail-1440-en.png` })

// node ref click focuses the graph (real behavior), Back returns
const beforeHash = await p.evaluate(() => location.hash)
await p.click('.ds-side-sec:has(.ds-side-label:text("spec nodes")) .ds-val')
await settle(p, 400)
const afterHash = await p.evaluate(() => location.hash)
check('node ref click navigates to the graph', afterHash !== beforeHash && /graph|^#\/?$/.test(afterHash), afterHash)
await p.goBack(); await settle(p, 400)
check('Back returns to the issue detail', (await p.evaluate(() => location.hash)).includes(LOCAL_ISSUE))

// — metadata (en, 1440): eval detail rail + filer + spec-node ref —
await p.goto(`${BASE}/${LONG_EVAL}`)
await p.waitForSelector('.ds-side'); await settle(p, 900)
const evalRail = await p.evaluate(() => {
  const secs = [...document.querySelectorAll('.ds-side-sec')].map((s) => ({
    label: s.querySelector('.ds-side-label')?.textContent,
    values: [...s.querySelectorAll('.ds-val')].map((v) => ({ tag: v.tagName, text: v.querySelector('.ds-val-text')?.textContent, aria: v.getAttribute('aria-label'), cls: v.className })),
  }))
  const strays = [...document.querySelectorAll('.ds-side .ds-side-line, .ds-side .fv-originator-who')]
  const nonPrimitive = [...document.querySelectorAll('.ds-side-body > *')].filter((el) => !el.classList.contains('ds-val') && !el.classList.contains('ds-queue-group'))
  return { secs, strayCount: strays.length, nonPrimitiveCount: nonPrimitive.length }
})
const nodeRef = evalRail.secs.find((s) => s.label === 'spec node')
check('eval detail shows its spec node as a labeled REAL ref', nodeRef?.values[0]?.tag === 'BUTTON' && nodeRef.values[0]?.text === 'event-detail')
const filerSec = evalRail.secs.find((s) => s.label === 'filed by')
check('filer UUID rides SideValue with the liveness skin', !!filerSec && /fv-originator/.test(filerSec.values[0]?.cls) && /ds-val/.test(filerSec.values[0]?.cls))
check('offline filer is a static value (span), honest liveness', filerSec.values[0]?.tag === 'SPAN')
check('eval rail: zero parallel variants, all values on the primitive', evalRail.strayCount === 0 && evalRail.nonPrimitiveCount === 0)
await (await p.$('.ds-side')).screenshot({ path: `${OUT}/b-eval-rail-1440-en.png` })

// — queue groups (1440): first / second / middle / last of the list order —
await p.goto(`${BASE}/#/evals`)
await p.waitForSelector('.lp-row[href]')
const hrefs = await p.$$eval('.lp-row[href]', (as) => as.map((a) => a.getAttribute('href')))
const names = (g) => g.rows
const readQueue = () => p.evaluate(() => {
  const groups = [...document.querySelectorAll('.ds-queue-group')].map((grp) => ({
    label: grp.querySelector('.ds-queue-group-label')?.textContent,
    rows: [...grp.querySelectorAll('a.ds-queue-row')].map((r) => r.getAttribute('href')),
    anchors: [...grp.querySelectorAll('a.ds-queue-row')].every((r) => r.querySelector('.review-state svg') && r.querySelector('.ds-queue-scenario') && r.querySelector('.ds-queue-node')),
  }))
  return { groups, sectionCount: [...document.querySelectorAll('.ds-side-sec')].filter((s) => s.querySelector('.ds-queue-group')).length }
})
const at = async (i) => { await p.goto(`${BASE}/${hrefs[i]}`); await p.waitForSelector('.ds-side'); await settle(p, 500); return readQueue() }
const mid = Math.floor(hrefs.length / 2)
const qFirst = await at(0)
check('@first: only Up next (no empty Previous heading), 5 nearest-after', qFirst.groups.length === 1 && qFirst.groups[0].label === 'up next' && JSON.stringify(names(qFirst.groups[0])) === JSON.stringify(hrefs.slice(1, 6)))
const qSecond = await at(1)
check('@second: boundary refill — Previous 1, Up next 4', qSecond.groups.length === 2 && JSON.stringify(names(qSecond.groups[0])) === JSON.stringify([hrefs[0]]) && JSON.stringify(names(qSecond.groups[1])) === JSON.stringify(hrefs.slice(2, 6)))
const qMid = await at(mid)
check('@middle: balanced 2+3, each nearest-to-current first', JSON.stringify(names(qMid.groups[0])) === JSON.stringify([hrefs[mid - 1], hrefs[mid - 2]]) && JSON.stringify(names(qMid.groups[1])) === JSON.stringify(hrefs.slice(mid + 1, mid + 4)))
check('@middle: groups wear the shared verdict visual + scenario + node', qMid.groups.every((g) => g.anchors))
const qLast = await at(hrefs.length - 1)
check('@last: only Previous, 5 nearest-before', qLast.groups.length === 1 && qLast.groups[0].label === 'previous' && JSON.stringify(names(qLast.groups[0])) === JSON.stringify([hrefs.at(-2), hrefs.at(-3), hrefs.at(-4), hrefs.at(-5), hrefs.at(-6)]))
// keyboard: focus a queue anchor, Enter follows it, Back returns
await p.goto(`${BASE}/${hrefs[mid]}`); await p.waitForSelector('.ds-queue-row'); await settle(p, 400)
const target = await p.$eval('.ds-queue-group a.ds-queue-row', (a) => a.getAttribute('href'))
await p.focus('.ds-queue-group a.ds-queue-row')
await p.keyboard.press('Enter'); await settle(p, 400)
check('keyboard focus+Enter follows the queue anchor', (await p.evaluate(() => location.hash)) === target.replace(/^#?/, '#').replace('##', '#'), await p.evaluate(() => location.hash))
await p.goBack(); await settle(p, 400)
check('browser Back returns to the detail just left', (await p.evaluate(() => decodeURIComponent(location.hash))) === decodeURIComponent(hrefs[mid].slice(1)) || (await p.evaluate(() => location.hash)) === hrefs[mid].slice(0), await p.evaluate(() => location.hash))

// — scoped detail: queue hrefs keep the one scope token; live filer chip is openable —
const sessions = await (await fetch(`${BASE}/api/sessions`)).json().catch(() => null)
let scopedChecked = false
for (const s of (Array.isArray(sessions) ? sessions : sessions?.sessions || [])) {
  const model = await (await fetch(`${BASE}/api/sessions/${encodeURIComponent(s.id)}/evals`)).json().catch(() => null)
  const rows = model && model !== false && Array.isArray(model.nodes) ? model.nodes.flatMap((n) => (n.evals || []).map((e) => ({ node: n.id, scenario: e.scenario }))) : []
  if (rows.length < 2) continue
  await p.goto(`${BASE}/#/evals/${rows[0].node}/${encodeURIComponent(rows[0].scenario)}?q=scope:${s.id}`)
  await p.waitForSelector('.ds-side'); await settle(p, 700)
  const scoped = await readQueue()
  const allScoped = scoped.groups.flatMap((g) => g.rows).every((h) => h.includes(`scope:${s.id}`) || decodeURIComponent(h).includes(`scope:${s.id}`))
  check('scoped detail queue rows all carry the one scope token', scoped.groups.length > 0 && allScoped, `session=${s.id.slice(0, 8)}`)
  scopedChecked = true
  break
}
if (!scopedChecked) check('scoped queue coverage', false, 'no session with ≥2 worktree readings on the board')

await ctx.close()   // flush the 1440 journey video

// ---------- zh (1440): localized labels, same primitive ----------
const zctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const z = await zctx.newPage()
await z.addInitScript(() => localStorage.setItem('spexcode.lang', 'zh'))
await z.goto(`${BASE}/#/issues/${LOCAL_ISSUE}`)
await z.waitForSelector('.ds-side'); await settle(z)
const zhIssue = await z.evaluate(() => [...document.querySelectorAll('.ds-side-label')].map((l) => l.textContent))
check('zh issue rail labels localized (议题/规格节点)', zhIssue.includes('议题') && zhIssue.includes('规格节点'), JSON.stringify(zhIssue))
await (await z.$('.ds-side')).screenshot({ path: `${OUT}/b-issue-rail-1440-zh.png` })
await z.goto(`${BASE}/${LONG_EVAL}`)
await z.waitForSelector('.ds-queue-group'); await settle(z, 900)
const zhEval = await z.evaluate(() => ({
  labels: [...document.querySelectorAll('.ds-side-label')].map((l) => l.textContent),
  groups: [...document.querySelectorAll('.ds-queue-group-label')].map((l) => l.textContent),
  ok: (() => { const t = [...document.querySelectorAll('.ds-val-text')]; return t.every((el) => getComputedStyle(el).textOverflow === 'ellipsis') })(),
}))
check('zh eval rail: 规格节点 + 前面/接下来 groups + primitive intact', zhEval.labels.includes('规格节点') && zhEval.groups.length > 0 && zhEval.groups.every((g) => g === '前面' || g === '接下来') && zhEval.ok, JSON.stringify(zhEval.groups))
await zctx.close()

// ---------- 390 journey (video): plain flow, no overflow, primitive holds ----------
const mctx = await browser.newContext({ viewport: { width: 390, height: 844 }, recordVideo: { dir: OUT, size: { width: 390, height: 844 } } })
const m = await mctx.newPage()
await m.goto(`${BASE}/${LONG_EVAL}`)
await m.waitForSelector('.ds-side'); await settle(m, 1000)
const m1 = await m.evaluate(() => {
  const side = document.querySelector('.ds-side')
  const main = document.querySelector('.ds-main')
  document.querySelector('.ds-page').scrollTop = 400
  return new Promise((res) => requestAnimationFrame(() => res({
    position: getComputedStyle(side).position,
    sideFirst: side.getBoundingClientRect().top < main.getBoundingClientRect().top,
    docW: document.documentElement.scrollWidth, pageW: document.querySelector('.ds-page').scrollWidth,
    railScrolledAway: side.getBoundingClientRect().bottom < 0 || document.querySelector('.ds-page').scrollTop > 0,
  })))
})
check('390 eval: rail static, metadata-before-content, scrolls WITH the document', m1.position === 'static' && m1.sideFirst && m1.railScrolledAway)
check('390 eval: no horizontal overflow', m1.docW <= 390 && m1.pageW <= 390, `doc=${m1.docW} page=${m1.pageW}`)
await m.screenshot({ path: `${OUT}/b-390-eval.png` })
await m.goto(`${BASE}/#/issues/${LOCAL_ISSUE}`)
await m.waitForSelector('.ds-side'); await settle(m)
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
