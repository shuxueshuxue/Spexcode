#!/usr/bin/env node
// split-recordings — cut whole-session e2e recordings into per-scenario clips + spec-yatsu step
// timelines, ready for `spex yatsu eval … --video --timeline` (the [[e2e-review]] skill's step 1).
//
// INPUT: a directory scanned recursively for pairs of one `.webm` + one `*.timeline.json` in the same
// folder (e.g. Playwright POOL workers: test-results/pool-video-w*/). The timeline is the EMITTER
// shape — `{ events: [{ atMs, kind, label }] }` — where a `narrate` event whose label starts with `▶`
// marks a scenario's start (`▶ <scenario> · <title>`), and each `frame` event marks a step inside it.
// The same scenario recorded twice (retry, another worker) resolves to the NEWEST recording.
//
// OUTPUT: `<out>/<scenario>.mp4` (h264 faststart — browser-seekable) + `<out>/<scenario>.timeline.json`
// in SpexCode's step-timeline format `{ v: 1, events: [{ tMs, step }] }` (clip-relative, validated by
// spec-yatsu at filing time). No title cards, no burned-in captions, no metadata table: the dashboard
// annotator renders scenario context live from the spec tree, so pixels stay evidence.
//
// usage: node split-recordings.mjs <recordings-dir> <out-dir> [--ffmpeg <path>]
import { execFileSync } from 'node:child_process'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'

const pos = process.argv.slice(2).filter((a) => !a.startsWith('--'))
if (pos.length < 2) {
  console.error('usage: node split-recordings.mjs <recordings-dir> <out-dir> [--ffmpeg <path>]')
  process.exit(1)
}
const [recDir, outDir] = pos.map((p) => resolve(p))
const fi = process.argv.indexOf('--ffmpeg')
const ffmpeg = fi > 0 ? process.argv[fi + 1] : 'ffmpeg'

// find every *.timeline.json recursively; its recording is the lone .webm beside it.
const timelines = []
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true })) {
    const p = join(d, e.name)
    if (e.isDirectory()) walk(p)
    else if (e.name.endsWith('.timeline.json')) timelines.push(p)
  }
}
walk(recDir)

// scenario -> { webm, startMs, endMs|null, steps[], mtime } — newest recording wins.
const seg = new Map()
for (const tl of timelines) {
  const dir = dirname(tl)
  const webm = readdirSync(dir).find((f) => f.endsWith('.webm'))
  if (!webm) { console.error(`✗ ${dir}: timeline with no .webm beside it — skipped`); continue }
  const webmPath = join(dir, webm)
  const mtime = statSync(webmPath).mtimeMs
  let events
  try { events = JSON.parse(readFileSync(tl, 'utf8')).events ?? [] } catch { console.error(`✗ ${tl}: unreadable JSON — skipped`); continue }
  events.sort((a, b) => a.atMs - b.atMs)
  const bounds = events.filter((e) => e.kind === 'narrate' && String(e.label ?? '').startsWith('▶'))
  bounds.forEach((b, i) => {
    const raw = String(b.label).replace(/^▶\s*/, '')
    const [name, title] = raw.includes(' · ') ? [raw.split(' · ')[0].trim(), raw.split(' · ').slice(1).join(' · ').trim()] : [raw.trim(), raw.trim()]
    if (!name) return
    const prev = seg.get(name)
    if (prev && prev.mtime > mtime) return
    const endMs = i + 1 < bounds.length ? bounds[i + 1].atMs : null
    const steps = events
      .filter((e) => e.kind === 'frame' && e.atMs >= b.atMs && (endMs === null || e.atMs < endMs))
      .map((e) => ({ tMs: Math.max(0, Math.round(e.atMs - b.atMs)), step: String(e.label ?? '').replace(/^📷\s*/, '').trim() || 'frame' }))
    seg.set(name, { webm: webmPath, startMs: b.atMs, endMs, steps, title, mtime })
  })
}

if (seg.size === 0) {
  console.error(`✗ no scenarios found under ${recDir} (need .webm + *.timeline.json pairs with ▶ narrate markers)`)
  process.exit(1)
}

mkdirSync(outDir, { recursive: true })
const slug = (s) => s.replace(/[^\p{L}\p{N}._-]+/gu, '-').replace(/^-+|-+$/g, '') || 'scenario'
let n = 0
const filed = []
for (const [name, s] of [...seg.entries()].sort()) {
  const base = slug(name)
  const mp4 = join(outDir, `${base}.mp4`)
  const tlOut = join(outDir, `${base}.timeline.json`)
  const args = ['-nostdin', '-y', '-ss', (s.startMs / 1000).toFixed(3)]
  if (s.endMs !== null) args.push('-t', ((s.endMs - s.startMs) / 1000).toFixed(3))
  args.push('-i', s.webm, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', mp4)
  try { execFileSync(ffmpeg, args, { stdio: ['ignore', 'ignore', 'pipe'] }) } catch (e) {
    const tail = String(e.stderr ?? e.message).trim().split('\n').pop()
    console.error(`✗ ${base}.mp4: ${tail}`)
    continue
  }
  const events = [{ tMs: 0, step: s.title || name }, ...s.steps]
  writeFileSync(tlOut, JSON.stringify({ v: 1, events }, null, 1))
  n++
  filed.push({ name, mp4, tlOut })
  const dur = s.endMs !== null ? `${((s.endMs - s.startMs) / 1000).toFixed(1)}s` : 'to-end'
  console.log(`✓ ${basename(mp4)}  (${dur}, ${events.length} steps)`)
}

console.log(`\n${n}/${seg.size} clips → ${outDir}`)
console.log('file each against its governing node (spex search <topic> finds it):')
for (const f of filed) console.log(`  spex yatsu eval <node> --scenario ${JSON.stringify(f.name)} --pass|--fail --video ${f.mp4} --timeline ${f.tlOut}`)
process.exit(n === seg.size ? 0 : 1)
