// parent-summary pressure track — Y2-adjacent groundwork appended to the drift-replay benchmark.
// Measures a DIFFERENT staleness surface than the Y1 localizer: not "did this code commit touch the
// spec contract" but "did this CHILD spec content version put the SUMMARY PARENT's body under
// pressure to be rewritten". Everything here is DESCRIPTIVE decision-surface enumeration:
//   - it does NOT implement or propose runtime lint/gate behavior, and deliberately does NOT choose
//     block vs warn for pressure — that grading waits on π_p (the share of pressure events where the
//     parent body truly needs rewriting), which only the HUMAN-labeled queue can estimate;
//   - nothing here is a causal claim — replay enumerates history against ancestry, it cannot say
//     what any gate would have changed.
//
// Event model: pressure event = a CONTENT version of a DIRECT child's spec.md (pure renames are not
// versions) that does NOT co-version the parent's spec.md in the same commit. A co-versioning
// (fused) commit updates the summary contemporaneously — no observable staleness gap — and is
// counted separately, never as pressure. A child version landing BEFORE the parent spec exists in
// its ancestry is a 'parent-not-yet-born' boundary row: reported, excluded, never guessed at.
//
// Ancestry, never timestamps: every ordering fact below (resolution, coverage, exposure spans,
// batching) is a git ancestry query on HEAD's commit DAG. Wall-clock order of parallel tips is
// meaningless in a multi-session repo and is never consulted.
//
// Coverage semantics (multi-child / parallel tips):
//   - PRESSURE IS A PREDICATE, not a counter: a parent with 5 uncovered child versions is pressed
//     exactly as much as one with 1 — the open-event count is backlog for the next rewrite's batch,
//     not a severity multiplier.
//   - a parent CONTENT UPDATE U covers exactly the child versions that are ancestors of U; a child
//     version on a parallel tip not yet merged beneath U stays uncovered (no cross-tip coverage).
//   - an ACK (a `Spec-OK: <node>` commit trailer) covers ONLY the parent it names, and only the
//     child versions that are ancestors of the ack commit (ancestor-visible). The trailer is the
//     observable fact; whether the ack was REASONED (the human actually re-read the summary) is not
//     observable from git and is reported as a boundary, never inferred.
//   - when incomparable minimal resolvers exist on parallel tips, the event is classed 'parallel'
//     (both cover it; neither precedes the other) — surfaced, not arbitrated.
//   - a parent update that resolves pressure may itself press ITS parent (upward propagation, depth
//     strictly decreasing — finite by tree height); it never presses its children (asserted below).
//
// Masking: a parent content update also bumps the parent's own spec version, which RESETS the code
// drift window of the parent's own governed `code:` file. Each resolving update therefore surfaces
// whether commits touched the parent's governed file since its previous version — i.e. whether this
// summary-refresh WOULD mask the parent's own pending code drift. Surfaced, not judged: intent
// (was the rewrite also about the code?) is not observable from git.
//
// Exposure (R1-analog, git-only LOWER bound): while a pressure event is unresolved, sibling child
// spec versions carrying a FOREIGN `Session:` trailer show other sessions kept versioning children
// under the stale summary. Trailerless commits count as 'unattributed'; spec READS outside commits
// are invisible to git — the true exposure can only be higher.
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { createHash } from 'node:crypto'

type Gate = { ok: boolean; msg: string }
type GitFn = (args: string[]) => string

export function runPressureTrack(opts: { ROOT: string; BENCH: string; git: GitFn; emitQueue: boolean }): { gates: Gate[] } {
  const { ROOT, BENCH, git, emitQueue } = opts
  const gates: Gate[] = []

  // ---- spec tree at HEAD: id, path, parent (nearest ancestor dir with spec.md), depth, fanout, code ----
  type Node = { id: string; dir: string; specPath: string; parent: string | null; depth: number; code: string | null }
  const nodes = new Map<string, Node>()
  const dirsWithSpec = new Set<string>()
  const walk = (d: string) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e)
      if (statSync(p).isDirectory()) walk(p)
      else if (e === 'spec.md') dirsWithSpec.add(dirname(p))
    }
  }
  walk(join(ROOT, '.spec'))
  const parseCode = (specAbs: string): string | null => {
    const txt = readFileSync(specAbs, 'utf8')
    const fm = txt.startsWith('---') ? txt.slice(3, txt.indexOf('\n---', 3)) : ''
    const m = fm.match(/^code:\s*\n\s+-\s+(\S+)/m)
    return m ? m[1] : null
  }
  for (const dir of [...dirsWithSpec].sort()) {
    let a = dirname(dir)
    let parent: string | null = null
    while (a.length >= ROOT.length + '/.spec'.length) {
      if (dirsWithSpec.has(a)) { parent = basename(a); break }
      a = dirname(a)
    }
    nodes.set(basename(dir), { id: basename(dir), dir, specPath: join(dir, 'spec.md').slice(ROOT.length + 1), parent, depth: -1, code: parseCode(join(dir, 'spec.md')) })
  }
  const depthOf = (n: Node): number => (n.depth !== -1 ? n.depth : (n.depth = n.parent ? depthOf(nodes.get(n.parent)!) + 1 : 0))
  for (const n of nodes.values()) depthOf(n)
  const fanout = new Map<string, number>()
  for (const n of nodes.values()) if (n.parent) fanout.set(n.parent, (fanout.get(n.parent) ?? 0) + 1)

  // ---- ancestry oracle: one rev-list, reachability bitsets over HEAD's whole DAG (no timestamps) ----
  const dagLines = git(['rev-list', '--topo-order', '--parents', 'HEAD']).trim().split('\n')
  const N = dagLines.length
  const idx = new Map<string, number>()
  const parentsOf: number[][] = new Array(N)
  dagLines.forEach((l, i) => idx.set(l.split(' ')[0], i))
  dagLines.forEach((l, i) => { parentsOf[i] = l.split(' ').slice(1).map((s) => idx.get(s)!).filter((x) => x !== undefined) })
  const W = Math.ceil(N / 32)
  const anc = new Uint32Array(N * W) // anc[i] = proper ancestors of commit i
  for (let i = N - 1; i >= 0; i--) { // topo-order lists descendants first → reversed = parents before children
    const base = i * W
    for (const p of parentsOf[i]) {
      const pb = p * W
      for (let w = 0; w < W; w++) anc[base + w] |= anc[pb + w]
      anc[base + (p >> 5)] |= 1 << (p & 31)
    }
  }
  const isProperAnc = (a: string, b: string): boolean => {
    const ia = idx.get(a), ib = idx.get(b)
    if (ia === undefined || ib === undefined || a === b) return false
    return (anc[ib * W + (ia >> 5)] & (1 << (ia & 31))) !== 0
  }
  const isAncEq = (a: string, b: string) => a === b || isProperAnc(a, b)

  // ---- per-node spec.md chains: content versions (renames excluded) + path points (renames kept) ----
  type Point = { sha: string; path: string; rename: boolean }
  const chains = new Map<string, Point[]>()
  for (const n of nodes.values()) {
    const pts: Point[] = []
    for (const block of git(['log', '--follow', '--format=%x01%H', '--name-status', '--reverse', '--', n.specPath]).split('\x01').filter(Boolean)) {
      const [hash, ...rest] = block.trim().split('\n')
      const stat = rest.find((l) => /^[AMR]/.test(l)) ?? ''
      const parts = stat.split('\t')
      pts.push({ sha: hash.trim(), path: (parts[0]?.startsWith('R') ? parts[2] : parts[1]) || n.specPath, rename: /^R100\t/.test(stat) })
    }
    chains.set(n.id, pts)
  }
  const versionsOf = (id: string) => (chains.get(id) ?? []).filter((p) => !p.rename)
  const pathAt = (id: string, commit: string): string | null => {
    let best: Point | null = null
    for (const p of chains.get(id) ?? []) if (isAncEq(p.sha, commit) && (!best || isAncEq(best.sha, p.sha))) best = p
    return best?.path ?? null
  }

  // ---- commit meta: Session trailer; Spec-OK acks per named node ----
  const sessionOf = new Map<string, string | null>()
  const acksOf = new Map<string, string[]>()
  for (const line of git(['log', '--format=%H\x01%(trailers:key=Session,valueonly,separator=%x2C)\x01%(trailers:key=Spec-OK,valueonly,separator=%x2C)', 'HEAD']).split('\n')) {
    const [h, sess, oks] = line.split('\x01')
    if (!h) continue
    sessionOf.set(h, sess?.split(',')[0]?.trim() || null)
    for (const v of (oks ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
      if (!acksOf.has(v)) acksOf.set(v, [])
      acksOf.get(v)!.push(h)
    }
  }

  // ---- enumerate pressure events ----
  type PEv = {
    id: string; parent: string; child: string; sha: string; depth: number // parent depth
    kind: 'update' | 'ack' | 'parallel' | 'open'; resolvers: string[]; resolverKinds: string[]
    foreign: Set<string>; unattributed: number
  }
  const events: PEv[] = []
  let coVersioned = 0, notYetBorn = 0, totalChildVersions = 0
  const notYetBornRows: string[] = []
  const childVersionsOfParent = new Map<string, { sha: string; child: string }[]>() // for exposure spans
  for (const n of [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!n.parent) continue
    const P = nodes.get(n.parent)!
    const pVers = new Set(versionsOf(P.id).map((v) => v.sha))
    for (const v of versionsOf(n.id)) {
      totalChildVersions++
      if (pVers.has(v.sha)) { coVersioned++; continue }
      if (!childVersionsOfParent.has(P.id)) childVersionsOfParent.set(P.id, [])
      childVersionsOfParent.get(P.id)!.push({ sha: v.sha, child: n.id })
      if (![...pVers].some((pv) => isProperAnc(pv, v.sha))) {
        notYetBorn++
        notYetBornRows.push(`${P.id}<-${n.id}`)
        continue
      }
      events.push({ id: `${P.id}<-${n.id}@${v.sha.slice(0, 8)}`, parent: P.id, child: n.id, sha: v.sha, depth: P.depth, kind: 'open', resolvers: [], resolverKinds: [], foreign: new Set(), unattributed: 0 })
    }
  }
  events.sort((a, b) => a.id.localeCompare(b.id))

  // ---- resolve each event: minimal resolvers by ancestry among parent updates + acks naming the parent ----
  for (const e of events) {
    const updates = versionsOf(e.parent).map((v) => v.sha).filter((u) => isProperAnc(e.sha, u))
    const acks = (acksOf.get(e.parent) ?? []).filter((a) => isAncEq(e.sha, a))
    const cands = [...new Set([...updates, ...acks])]
    const minimal = cands.filter((c) => !cands.some((o) => o !== c && isProperAnc(o, c))).sort()
    e.resolvers = minimal
    e.resolverKinds = minimal.map((r) => (versionsOf(e.parent).some((v) => v.sha === r) ? 'update' : 'ack'))
    e.kind = minimal.length === 0 ? 'open' : minimal.length > 1 ? 'parallel' : (e.resolverKinds[0] as 'update' | 'ack')
  }

  // ---- exposure spans (git-only lower bound): foreign-session sibling child versions inside the span ----
  for (const e of events) {
    const own = sessionOf.get(e.sha) ?? null
    for (const s of childVersionsOfParent.get(e.parent) ?? []) {
      if (s.sha === e.sha || e.resolvers.includes(s.sha)) continue
      if (!isProperAnc(e.sha, s.sha)) continue
      if (e.kind !== 'open' && !e.resolvers.some((r) => isProperAnc(s.sha, r))) continue
      const sess = sessionOf.get(s.sha) ?? null
      if (!sess) e.unattributed++
      else if (sess !== own) e.foreign.add(sess)
    }
  }

  // ---- batching: events resolved by the same resolver set collapse into one batch ----
  const batches = new Map<string, PEv[]>()
  for (const e of events) {
    if (e.kind === 'open') continue
    const k = `${e.parent}\x01${e.resolvers.join(',')}`
    if (!batches.has(k)) batches.set(k, [])
    batches.get(k)!.push(e)
  }

  // ---- masking: does a resolving parent update sit on pending code drift of the parent's own file? ----
  const maskByUpdate = new Map<string, number | 'no-code'>() // `${parent}\x01${U}` -> drift commits it would mask
  for (const k of [...batches.keys()].sort()) {
    const [parent, resolverCsv] = k.split('\x01')
    const P = nodes.get(parent)!
    for (const U of resolverCsv.split(',')) {
      if (!versionsOf(parent).some((v) => v.sha === U)) continue // acks bump no version → mask nothing
      const mk = `${parent}\x01${U}`
      if (maskByUpdate.has(mk)) continue
      if (!P.code) { maskByUpdate.set(mk, 'no-code'); continue }
      const prevs = versionsOf(parent).map((v) => v.sha).filter((v) => isProperAnc(v, U))
      const prevMax = prevs.filter((v) => !prevs.some((o) => o !== v && isProperAnc(v, o)))
      const out = git(['rev-list', '--no-merges', U, ...prevMax.map((p) => `^${p}`), '--', P.code]).trim().split('\n').filter((s) => s && s !== U)
      maskByUpdate.set(mk, out.length)
    }
  }

  // ---- report ----
  console.log('\n== parent-summary pressure track (Y2-adjacent groundwork; descriptive only) ==')
  console.log('   event = a direct child spec CONTENT version that does not co-version its summary parent —')
  console.log('   the moment the parent body may go stale. All ordering is git ancestry; timestamps are never')
  console.log('   consulted. This track implements NO runtime lint/gate behavior and does NOT choose block vs')
  console.log('   warn for pressure — that grading waits on π_p (human queue below) and is out of replay scope;')
  console.log('   no number here is a causal claim about what any gate would change.')
  console.log(`\npopulation: ${totalChildVersions} direct-child spec versions across ${childVersionsOfParent.size} parents → ${events.length} pressure events`)
  console.log(`  + ${coVersioned} co-versioned (fused child+parent commit — summary updated contemporaneously, no gap)`)
  console.log(`  + ${notYetBorn} parent-not-yet-born (child versioned before the parent spec existed in its ancestry — boundary, excluded)`)
  const kinds = { update: 0, ack: 0, parallel: 0, open: 0 }
  for (const e of events) kinds[e.kind]++
  console.log(`\nresolution channels (ancestry-minimal resolver per event): parent-content-update ${kinds.update} · ack (Spec-OK trailer naming the parent) ${kinds.ack} · parallel (incomparable resolvers on parallel tips) ${kinds.parallel} · open at HEAD ${kinds.open}`)
  console.log('  an ack covers only the parent it names and only ancestor-visible child versions; the trailer is')
  console.log('  observable but whether the ack was REASONED (summary actually re-read) is NOT observable from git.')

  // by parent depth
  console.log('\nby parent depth (depth 0 = project root):')
  console.log('  depth   parents  events  update     ack  parallel   open')
  const byDepth = new Map<number, PEv[]>()
  for (const e of events) { if (!byDepth.has(e.depth)) byDepth.set(e.depth, []); byDepth.get(e.depth)!.push(e) }
  for (const d of [...byDepth.keys()].sort((a, b) => a - b)) {
    const evs = byDepth.get(d)!
    const c = { update: 0, ack: 0, parallel: 0, open: 0 }
    for (const e of evs) c[e.kind]++
    console.log(`  ${String(d).padStart(5)}   ${String(new Set(evs.map((e) => e.parent)).size).padStart(7)} ${String(evs.length).padStart(7)} ${String(c.update).padStart(7)} ${String(c.ack).padStart(7)} ${String(c.parallel).padStart(9)} ${String(c.open).padStart(6)}`)
  }

  // per parent
  console.log('\nper parent (fanout = direct children at HEAD; exposure = distinct foreign Session trailers on')
  console.log('sibling child versions inside unresolved spans — a git-only LOWER bound, reads are invisible):')
  const parents = [...new Set(events.map((e) => e.parent))].sort()
  for (const p of parents) {
    const evs = events.filter((e) => e.parent === p)
    const c = { update: 0, ack: 0, parallel: 0, open: 0 }
    const foreign = new Set<string>()
    let unattr = 0
    for (const e of evs) { c[e.kind]++; e.foreign.forEach((s) => foreign.add(s)); unattr += e.unattributed }
    const nBatches = [...batches.keys()].filter((k) => k.startsWith(p + '\x01')).length
    const masks = [...maskByUpdate.entries()].filter(([k]) => k.startsWith(p + '\x01'))
    const masked = masks.filter(([, v]) => typeof v === 'number' && v > 0)
    const maskNote = nodes.get(p)!.code
      ? `masking ${masked.length}/${masks.length} updates (would reset pending code drift of ${nodes.get(p)!.code})`
      : 'no code: (pure summary node — nothing to mask)'
    console.log(`  ${p.padEnd(22)} depth ${evs[0].depth} · fanout ${String(fanout.get(p) ?? 0).padStart(2)} · events ${String(evs.length).padStart(3)} → batches ${String(nBatches).padStart(2)} · upd ${c.update} ack ${c.ack} par ${c.parallel} open ${c.open} · exposure ${foreign.size}${unattr ? ` (+${unattr} unattributed)` : ''} · ${maskNote}`)
  }

  // batching stats + pressure predicate at HEAD
  const sizes = [...batches.values()].map((b) => b.length)
  const resolvedCount = events.length - kinds.open
  console.log(`\nbatching: ${resolvedCount} resolved events collapse into ${batches.size} batches (mean ${(resolvedCount / Math.max(1, batches.size)).toFixed(1)}, max ${Math.max(0, ...sizes)}) — one parent rewrite/ack covers every ancestor-visible pending child version at once`)
  const pressed = parents.filter((p) => events.some((e) => e.parent === p && e.kind === 'open')).sort()
  console.log(`pressure predicate at HEAD (a PREDICATE, not a counter — open-event count is backlog for the next batch, not severity): ${pressed.length ? `pressed parents: ${pressed.map((p) => `${p}(${events.filter((e) => e.parent === p && e.kind === 'open').length} open)`).join(' · ')}` : 'no parent pressed'}`)
  if (notYetBorn) {
    const perPair = new Map<string, number>()
    for (const r of notYetBornRows) perPair.set(r, (perPair.get(r) ?? 0) + 1)
    console.log(`unresolved data (reported, not inferred): parent-not-yet-born child versions per pair (mostly children reparented under a later-created grouping node — their pre-parent history cannot press a summary that did not exist):`)
    console.log(`  ${[...perPair.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k} ×${v}`).join(' · ')}`)
  }

  // ---- π_p human audit queue: blinded, deterministic, stratified by parent depth — HUMAN-ONLY ----
  const QUEUE_PATH = join(BENCH, 'pressure-audit-queue.json')
  const QUEUE_N = 40
  const sha256 = (s: string) => createHash('sha256').update(s).digest('hex')
  // The sampling frame is FROZEN at the generating HEAD (recorded as `frozenAt` in the file):
  // only events whose commit is an ancestor of frozenAt are sampled, so later history never
  // reshuffles the strata — the determinism gate stays byte-stable as HEAD advances. (The Y1
  // queue gets the same stability from the frozen truth file; this queue has no truth yet.)
  function buildQueue(frozenAt: string): string {
    const frame = events.filter((e) => isAncEq(e.sha, frozenAt))
    const frameByDepth = new Map<number, PEv[]>()
    for (const e of frame) { if (!frameByDepth.has(e.depth)) frameByDepth.set(e.depth, []); frameByDepth.get(e.depth)!.push(e) }
    const depths = [...frameByDepth.keys()].sort((a, b) => a - b)
    let quota = new Map<number, number>()
    if (frame.length <= QUEUE_N) {
      for (const d of depths) quota.set(d, frameByDepth.get(d)!.length)
    } else {
      const exact = depths.map((d) => ({ d, x: (QUEUE_N * frameByDepth.get(d)!.length) / frame.length }))
      quota = new Map(exact.map(({ d, x }) => [d, Math.floor(x)]))
      let left = QUEUE_N - [...quota.values()].reduce((a, b) => a + b, 0)
      for (const { d } of exact.sort((a, b) => (b.x - Math.floor(b.x)) - (a.x - Math.floor(a.x)) || a.d - b.d)) {
        if (left <= 0) break
        quota.set(d, quota.get(d)! + 1); left--
      }
      // π_p must be estimable BY DEPTH: floor every non-empty stratum at min(3, |stratum|), donors = largest quotas
      for (const d of depths) {
        const need = Math.min(3, frameByDepth.get(d)!.length)
        while (quota.get(d)! < need) {
          const donor = depths.filter((o) => quota.get(o)! > Math.min(3, frameByDepth.get(o)!.length)).sort((a, b) => quota.get(b)! - quota.get(a)! || a - b)[0]
          if (donor === undefined) break
          quota.set(donor, quota.get(donor)! - 1)
          quota.set(d, quota.get(d)! + 1)
        }
      }
    }
    const rows: object[] = []
    for (const d of depths) {
      const pick = [...frameByDepth.get(d)!].sort((a, b) => sha256(a.id).localeCompare(sha256(b.id))).slice(0, quota.get(d))
      for (const e of pick) {
        const P = nodes.get(e.parent)!
        const parentPath = pathAt(P.id, e.sha)!
        const childPath = pathAt(e.child, e.sha)!
        rows.push({
          id: e.id, parentNode: e.parent, childNode: e.child, commit: e.sha,
          show: { parentSpec: `git show ${e.sha.slice(0, 12)}:${parentPath}`, childDiff: `git show ${e.sha.slice(0, 12)} -- ${childPath}` },
          humanVerdict: null, humanNote: null,
        })
      }
    }
    rows.sort((a: any, b: any) => a.id.localeCompare(b.id))
    return JSON.stringify({
      purpose: 'HUMAN estimation of π_p — the share of pressure events where the summary parent body TRULY needs rewriting. Per row, a HUMAN reads the parent spec body as of the pressing commit (first `show` command) and the child spec.md change (second `show` command), then sets humanVerdict to true (this child change makes the parent body stale — its summary of this area no longer holds) or false (the parent body still holds as written), plus an optional humanNote. Do not consult the current .spec tree, later history, or whether the parent was later updated/acked. A model must NEVER fill these fields — machine-filled rows void the estimate; π_p is UNKNOWN and this file is not human validation until a person fills it. Rows are stratified by parent depth (recover a row’s depth by counting the parent’s ancestors in .spec) so π_p can be estimated per depth.',
      generatedFrom: 'pressure events replayed from git history (deterministic; regenerate with --emit-audit-queue)',
      frozenAt,
      rejoin: 'answers rejoin the replay by id; π_p by depth = mean(humanVerdict) within each parent-depth stratum',
      rows,
    }, null, 1) + '\n'
  }
  let queueOk = true, queueMsg = ''
  if (emitQueue) {
    const head = git(['rev-parse', 'HEAD']).trim()
    const queueNow = buildQueue(head)
    writeFileSync(QUEUE_PATH, queueNow)
    queueMsg = `pressure-audit-queue.json regenerated (${JSON.parse(queueNow).rows.length} rows, frame frozen at ${head.slice(0, 12)})`
  } else if (!existsSync(QUEUE_PATH)) {
    queueOk = false; queueMsg = 'pressure-audit-queue.json MISSING — generate it with --emit-audit-queue and commit it'
  } else {
    const committed = readFileSync(QUEUE_PATH, 'utf8')
    const frozenAt: string | undefined = JSON.parse(committed).frozenAt
    if (!frozenAt || !idx.has(frozenAt)) {
      queueOk = false; queueMsg = `pressure-audit-queue.json frozenAt ${frozenAt ? `${frozenAt.slice(0, 12)} is not in HEAD ancestry` : 'missing'} — regenerate with --emit-audit-queue and say why in the commit reason`
    } else {
      const queueNow = buildQueue(frozenAt)
      const masked = committed.replace(/"humanVerdict": (true|false)/g, '"humanVerdict": null').replace(/"humanNote": "(?:[^"\\]|\\.)*"/g, '"humanNote": null')
      if (masked !== queueNow) queueOk = false, queueMsg = 'pressure-audit-queue.json DIVERGES from deterministic regeneration at its frozen frame — sampling or context changed; regenerate with --emit-audit-queue and say why in the commit reason'
      else if (/"(kind|resolvers|resolverKinds|depth|foreign|unattributed|batch|mask)"/.test(committed)) queueOk = false, queueMsg = 'pressure-audit-queue.json LEAKS engine fields — the queue must stay blinded'
      else {
        const filled = (committed.match(/"humanVerdict": (true|false)/g) ?? []).length
        const total = JSON.parse(queueNow).rows.length
        queueMsg = `pressure-audit-queue.json verified: ${total} blinded rows, deterministic (frame frozen at ${frozenAt.slice(0, 12)}), no engine-field leakage · human-filled ${filled}/${total}${filled ? '' : ' (PENDING — not yet human validation)'}`
      }
    }
  }
  console.log(`\nπ_p human audit queue: ${queueMsg}`)
  console.log('π_p is NOT computable from git and is NOT estimated here — the queue awaits HUMAN verdicts; until')
  console.log('filled, pressure counts above are event counts, not "the parent truly needed rewriting" counts.')

  // ---- property assertions (executable, gate on failure) ----
  const treeParentOk = events.every((e) => nodes.get(e.child)!.parent === e.parent && nodes.get(e.child)!.depth === e.depth + 1)
  gates.push({ ok: treeParentOk, msg: 'pressure: upward-only — every event presses exactly the versioned child’s tree parent (depth strictly decreases)' })
  const maxDepth = Math.max(0, ...[...nodes.values()].map((n) => n.depth))
  gates.push({ ok: events.every((e) => e.depth < nodes.get(e.child)!.depth) && maxDepth < 100, msg: `pressure: finite convergence — upward propagation strictly decreases depth, chains bounded by tree height (${maxDepth})` })
  gates.push({ ok: events.every((e) => !e.resolvers.some((r) => isProperAnc(r, e.sha))), msg: 'pressure: no resolver precedes its own pressure event (anti-cycle by ancestry)' })
  const batchSum = sizes.reduce((a, b) => a + b, 0)
  gates.push({ ok: batchSum === resolvedCount && batches.size <= Math.max(1, resolvedCount), msg: `pressure: batching partitions resolved events exactly (${resolvedCount} events → ${batches.size} batches, no double-count)` })
  const pairSet = new Set(events.map((e) => `${e.child}\x01${e.parent}`))
  const noOsc = events.every((e) => !pairSet.has(`${e.parent}\x01${e.child}`) && !nodes.get(e.parent)!.dir.startsWith(nodes.get(e.child)!.dir + '/'))
  gates.push({ ok: noOsc, msg: 'pressure: no downward oscillation — no event presses a descendant, no child↔parent pressure pair' })
  gates.push({ ok: kinds.update + kinds.ack + kinds.parallel + kinds.open + coVersioned + notYetBorn === totalChildVersions, msg: 'pressure: totality — every child version classified (update/ack/parallel/open/co-versioned/not-yet-born), boundaries reported not inferred' })
  gates.push({ ok: queueOk, msg: 'pressure: π_p audit queue deterministic + blinded (human-only)' })
  return { gates }
}
