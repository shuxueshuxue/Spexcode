import { spawn } from 'node:child_process'
import { gitA, headSha } from '../../spec-cli/src/git.js'
import { parseScenarios } from './yatsu.js'

// @@@ per-scenario content freshness — the SCENARIO axis, sub-file
// A yatsu.md holds many scenarios, but a reading measures ONE. yatsu-core's contract says "a scenario is the
// unit of measurement, so its freshness is its OWN — two scenarios stale independently." Git has no sub-file
// history, so we build it: for each scenario NAME in a yatsu.md, the commits where THAT scenario's block
// content changed (added / removed / edited), rename-followed. `scenarioMoved` then reads exactly like the
// code axis's `changedSince` — a pure ancestry lookup over this per-scenario commit list — so editing one
// scenario never re-stales its siblings (the file-granular bug this replaces).

const RS = '\x1e'

// yatsuPath (head path) -> scenario name -> commit hashes that changed that scenario's block (newest-first)
export type ScenarioIndex = Map<string, Map<string, string[]>>

// the block content that stales a reading: everything a measurement is taken AGAINST, minus the name (the
// join key — a renamed scenario is a remove+add, surfaced as a change-commit on each name). parseScenarios
// already folds YAML block scalars, so a pure prose re-wrap yields the same string and does NOT stale.
function blockContent(src: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const s of parseScenarios(src)) {
    m.set(s.name, JSON.stringify({ d: s.description, e: s.expected, t: s.tags ?? [], c: s.code ?? [], r: s.related ?? [], x: s.test ?? '' }))
  }
  return m
}

const ZERO = '0'.repeat(40)   // the null OID a delete/add carries on its absent side
const EMPTY: Map<string, string> = new Map()

// content-addressed: a blob OID -> its canonical per-scenario block map. Git objects are IMMUTABLE, so this
// memo never needs invalidation and is shared across every root — a per-worktree build reuses the blocks main
// already parsed, which is what lets a worktree's freshness build stay cheap instead of re-reading everything.
const blockByOid = new Map<string, Map<string, string>>()

// ONE `git log --raw` walk over all yatsu.md → per head-path version chain [{hash, oid}], newest-first,
// rename-followed via the `alias` idiom (git.ts buildIndex): the newest sighting of a path IS its head path;
// an `R` row remaps the older `from` path onto that head. The raw row carries the new blob OID directly, so
// no per-version path resolution and no `git show`. --full-history is REQUIRED: default pathspec
// history-simplification prunes commits off HEAD's first-parent chain, but in this repo every spec edit lands
// via a --no-ff merge of a node branch, so those pruned commits ARE the scenario edits — dropping them would
// under-report staleness (a stale reading judged fresh). Merge commits emit no raw diff row, so they add no
// version (exactly as the old `--follow` did).
async function fileChains(root: string, wanted: Set<string>): Promise<Map<string, { hash: string; oid: string }[]>> {
  const chains = new Map<string, { hash: string; oid: string }[]>()
  const alias = new Map<string, string>()
  const out = await gitA(['-C', root, '-c', 'core.quotePath=false', 'log',
    '--raw', '--no-abbrev', '--full-history', '-M', `--format=${RS}%H`, '--', '*yatsu.md'])
  for (const rec of out.split(RS)) {
    const nl = rec.indexOf('\n')
    if (nl < 0) continue
    const hash = rec.slice(0, nl)
    if (!hash) continue
    for (const line of rec.slice(nl + 1).split('\n')) {
      if (line[0] !== ':') continue           // `:<oldmode> <newmode> <oldoid> <newoid> <status>\t<path>[\t<path2>]`
      const tab = line.indexOf('\t')
      if (tab < 0) continue
      const meta = line.slice(1, tab).split(' ')
      const oid = meta[3], rename = meta[4][0] === 'R' || meta[4][0] === 'C'
      const paths = line.slice(tab + 1).split('\t')
      const to = rename ? paths[1] : paths[0]   // the path on the newer side of this commit
      let head = alias.get(to)
      if (head === undefined) { head = to; alias.set(to, to) }
      let arr = chains.get(head); if (!arr) { arr = []; chains.set(head, arr) }
      arr.push({ hash, oid })
      if (rename && paths[0] !== to) { alias.set(paths[0], head); alias.delete(to) }   // older history calls it `from`
    }
  }
  for (const k of [...chains.keys()]) if (!wanted.has(k)) chains.delete(k)   // keep only the head paths asked for
  return chains
}

// per-scenario change-commits for one file's version chain: newest->oldest, attribute a commit to every
// scenario whose canonical block differs from the next-older version (undefined either side = add/remove = a
// change). A ZERO-oid (delete) version is dropped — it carries no readable content, matching the old
// `git show ''` skip; a pure rename (R100, oid == the older version's oid) diffs to no change for free.
function scenarioCommits(chain: { hash: string; oid: string }[]): Map<string, string[]> {
  const commits = new Map<string, string[]>()
  const push = (name: string, hash: string) => { const a = commits.get(name); if (a) a.push(hash); else commits.set(name, [hash]) }
  const real = chain.filter((v) => v.oid !== ZERO)
  for (let i = 0; i < real.length; i++) {
    const cur = blockByOid.get(real[i].oid) ?? EMPTY
    const older = i + 1 < real.length ? (blockByOid.get(real[i + 1].oid) ?? EMPTY) : EMPTY
    for (const name of new Set([...cur.keys(), ...older.keys()])) {
      if (cur.get(name) !== older.get(name)) push(name, real[i].hash)
    }
  }
  return commits
}

// read MANY blobs in ONE `git cat-file --batch` process (vs one `git show` per blob). Feeds the OIDs on
// stdin, parses the `<oid> <type> <size>\n<payload>\n` records byte-accurately (size is bytes; blobs are
// UTF-8). A `<oid> missing` line yields no entry. Env-stripped like git.ts's helpers (a stray GIT_DIR would
// misroute repo discovery); kept here beside its only caller — a general git-seam primitive if a second
// caller ever wants one.
function catFileBatch(root: string, oids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (!oids.length) return Promise.resolve(out)
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    delete env.GIT_DIR; delete env.GIT_WORK_TREE; delete env.GIT_INDEX_FILE; delete env.GIT_OBJECT_DIRECTORY
    const p = spawn('git', ['-C', root, 'cat-file', '--batch'], { env, timeout: Number(process.env.SPEXCODE_GIT_TIMEOUT_MS || 120000), killSignal: 'SIGKILL' })
    const chunks: Buffer[] = []
    p.stdout.on('data', (c: Buffer) => chunks.push(c))
    p.on('error', reject)
    p.on('close', (_code, signal) => {
      // a child that never exited was SIGKILLed at the timeout (a hung git must not pin this promise —
      // same bound as git.ts's helpers); warn loudly and parse whatever arrived.
      if (signal === 'SIGKILL') console.warn(`spec-yatsu: git cat-file --batch killed after timeout — child never exited`)
      const buf = Buffer.concat(chunks)
      let i = 0
      while (i < buf.length) {
        const nl = buf.indexOf(0x0a, i)
        if (nl < 0) break
        const header = buf.toString('utf8', i, nl)
        i = nl + 1
        if (header.endsWith(' missing')) continue   // unknown OID — no payload follows
        const size = Number(header.slice(header.lastIndexOf(' ') + 1))
        if (!Number.isFinite(size)) break
        out.set(header.slice(0, header.indexOf(' ')), buf.toString('utf8', i, i + size))
        i += size + 1   // payload + its trailing newline
      }
      resolve(out)
    })
    p.stdin.on('error', () => { /* EPIPE if git exits early; the close handler reports what arrived */ })
    p.stdin.write(oids.join('\n') + '\n')
    p.stdin.end()
  })
}

// TWO git subprocesses for the whole index (was F logs + V shows): one `--raw` log for the rename-followed
// chains, one `cat-file --batch` for every distinct blob not already memoized. Then a pure in-memory diff.
async function build(root: string, yatsuPaths: string[]): Promise<ScenarioIndex> {
  const chains = await fileChains(root, new Set(yatsuPaths))
  const need = new Set<string>()
  for (const chain of chains.values()) for (const v of chain) if (v.oid !== ZERO && !blockByOid.has(v.oid)) need.add(v.oid)
  if (need.size) {
    const blobs = await catFileBatch(root, [...need])
    for (const [oid, src] of blobs) blockByOid.set(oid, blockContent(src))
  }
  const idx: ScenarioIndex = new Map()
  for (const p of yatsuPaths) idx.set(p, scenarioCommits(chains.get(p) ?? []))   // every asked path gets an entry (empty if untracked)
  return idx
}

// HEAD-keyed LRU, mirroring historyIndex/driftIndex in git.ts: same head ⇒ same per-scenario history,
// whatever the caller. Holds the in-flight promise so concurrent board builds share one build.
const SLOTS = 16
const cache = new Map<string, Promise<ScenarioIndex>>()
export function scenarioIndex(root: string, yatsuPaths: string[]): Promise<ScenarioIndex> {
  let head: string
  try { head = headSha(root) } catch { return build(root, yatsuPaths) }
  const hit = cache.get(head)
  if (hit) { cache.delete(head); cache.set(head, hit); return hit }
  const p = build(root, yatsuPaths)
  p.catch(() => cache.delete(head))
  cache.set(head, p)
  while (cache.size > SLOTS) cache.delete(cache.keys().next().value!)
  return p
}

export function scenarioChangeCommits(idx: ScenarioIndex, yatsuPath: string, scenario: string): string[] {
  return idx.get(yatsuPath)?.get(scenario) ?? []
}
