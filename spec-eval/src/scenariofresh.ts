import { spawn } from 'node:child_process'
import { git, gitA, gitTry, headSha } from '../../spec-cli/src/git.js'
import { parseScenarios } from './scenarios.js'
import { rootSlots, touchRoot as touchRootLru } from '../../spec-cli/src/root-lru.js'

const RS = '\x1e'

export type ScenarioIndex = Map<string, Map<string, string[]>>

function blockContent(src: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const s of parseScenarios(src)) {
    m.set(s.name, JSON.stringify({ d: s.description, e: s.expected }))
  }
  return m
}

const ZERO = '0'.repeat(40)
const EMPTY: Map<string, string> = new Map()

const blockByOid = new Map<string, Map<string, string>>()

async function fileChains(root: string, wanted: Set<string>): Promise<Map<string, { hash: string; oid: string }[]>> {
  const chains = new Map<string, { hash: string; oid: string }[]>()
  const alias = new Map<string, string>()
  const out = await gitA(['-C', root, '-c', 'core.quotePath=false', 'log',
    '--raw', '--no-abbrev', '--full-history', '-M', `--format=${RS}%H`, '--', '*eval.md', '*yatsu.md']) // dead-words-ok: archived pathspec — immutable pre-rename history is read under its archived name
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
      const to = rename ? paths[1] : paths[0]
      let head = alias.get(to)
      if (head === undefined) { head = to; alias.set(to, to) }
      let arr = chains.get(head); if (!arr) { arr = []; chains.set(head, arr) }
      arr.push({ hash, oid })
      if (rename && paths[0] !== to) { alias.set(paths[0], head); alias.delete(to) }
    }
  }
  for (const k of [...chains.keys()]) if (!wanted.has(k)) chains.delete(k)
  return chains
}

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
      if (signal === 'SIGKILL') console.warn(`spec-eval: git cat-file --batch killed after timeout — child never exited`)
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

async function build(root: string, evalPaths: string[]): Promise<ScenarioIndex> {
  const chains = await fileChains(root, new Set(evalPaths))
  const need = new Set<string>()
  for (const chain of chains.values()) for (const v of chain) if (v.oid !== ZERO && !blockByOid.has(v.oid)) need.add(v.oid)
  if (need.size) {
    const blobs = await catFileBatch(root, [...need])
    for (const [oid, src] of blobs) blockByOid.set(oid, blockContent(src))
  }
  const idx: ScenarioIndex = new Map()
  for (const p of evalPaths) idx.set(p, scenarioCommits(chains.get(p) ?? []))
  return idx
}

const SLOTS = rootSlots(process.env.SPEXCODE_SCENARIO_CACHE_ROOTS, 16)
const cache = new Map<string, Promise<ScenarioIndex>>()
const roots = new Map<string, string>()

function touchRoot(root: string, head: string): void {
  touchRootLru(roots, cache, root, head, SLOTS)
}

export function scenarioIndex(root: string, evalPaths: string[]): Promise<ScenarioIndex> {
  let head: string
  try { head = headSha(root) } catch { return build(root, evalPaths) }
  touchRoot(root, head)
  const hit = cache.get(head)
  if (hit) { cache.delete(head); cache.set(head, hit); return hit }
  const p = build(root, evalPaths)
  p.catch(() => cache.delete(head))
  cache.set(head, p)
  while (cache.size > SLOTS) cache.delete(cache.keys().next().value!)
  return p
}

export function scenarioCacheStats(): { heads: number; roots: number } {
  return { heads: cache.size, roots: roots.size }
}

export function scenarioChangeCommits(idx: ScenarioIndex, evalPath: string, scenario: string): string[] {
  return idx.get(evalPath)?.get(scenario) ?? []
}

const FULL_SHA = /^[0-9a-f]{40}$/
const oidMemo = new Map<string, string>()
function oidAt(root: string, rev: string, path: string): string {
  const resolve = () => { try { return git(['-C', root, 'rev-parse', `${rev}:${path}`]).trim() } catch { return '' } }
  if (!FULL_SHA.test(rev)) return resolve()
  const k = `${root}\x1f${rev}\x1f${path}`
  const hit = oidMemo.get(k)
  if (hit !== undefined) { oidMemo.delete(k); oidMemo.set(k, hit); return hit }
  const v = resolve()
  oidMemo.set(k, v)
  if (oidMemo.size > 4096) oidMemo.delete(oidMemo.keys().next().value!)
  return v
}

async function oidAtAsync(root: string, rev: string, path: string): Promise<string> {
  if (!FULL_SHA.test(rev)) return (await gitTry(['-C', root, 'rev-parse', `${rev}:${path}`])).stdout.trim()
  const k = `${root}\x1f${rev}\x1f${path}`
  const hit = oidMemo.get(k)
  if (hit !== undefined) { oidMemo.delete(k); oidMemo.set(k, hit); return hit }
  const result = await gitTry(['-C', root, 'rev-parse', `${rev}:${path}`])
  const oid = result.ok ? result.stdout.trim() : ''
  oidMemo.set(k, oid)
  if (oidMemo.size > 4096) oidMemo.delete(oidMemo.keys().next().value!)
  return oid
}


export async function primeScenarioBlocksAt(root: string, revs: string[], path: string): Promise<void> {
  for (const rev of revs) {
    const oid = await oidAtAsync(root, rev, path)
    if (!oid || blockByOid.has(oid)) continue
    const src = await gitA(['-C', root, 'cat-file', 'blob', oid]) // dead-words-ok: git plumbing
    if (src) blockByOid.set(oid, blockContent(src))
  }
}

export function scenarioBlocksAt(root: string, rev: string, path: string): Map<string, string> | null {
  const oid = oidAt(root, rev, path)
  if (!oid) return null
  const hit = blockByOid.get(oid)
  if (hit) return hit
  try {
    const m = blockContent(git(['-C', root, 'cat-file', 'blob', oid])) // dead-words-ok: git plumbing — 'blob' is git's object type, not our vocabulary
    blockByOid.set(oid, m)
    return m
  } catch { return null }
}
