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

// the file's content-versions newest-first, each { hash, blocks }. Skips a version we can't read (git show
// '') so an unreadable blob never fabricates a remove+re-add diff.
async function fileVersions(root: string, headPath: string): Promise<{ hash: string; blocks: Map<string, string> }[]> {
  // --follow + --name-only pairs each commit with the path the file had THERE, so `git show <hash>:<pathAtCommit>`
  // works across reparents (yatsu.md moves when its node does). `-M` keeps a rename+edit's content.
  const log = await gitA(['-C', root, '-c', 'core.quotePath=false', 'log', '-M', '--follow', `--format=${RS}%H`, '--name-only', '--', headPath])
  const out: { hash: string; blocks: Map<string, string> }[] = []
  for (const rec of log.split(RS)) {
    const lines = rec.split('\n').map((l) => l.trim()).filter(Boolean)
    if (!lines.length) continue
    const hash = lines[0]
    const pathAt = lines.slice(1).find((l) => l.endsWith('/yatsu.md') || l === 'yatsu.md') ?? headPath
    const content = await gitA(['-C', root, 'show', `${hash}:${pathAt}`])
    if (!content) continue
    out.push({ hash, blocks: blockContent(content) })
  }
  return out
}

// per-scenario change-commits for one file: walk versions newest->oldest, attribute a commit to every
// scenario whose block differs from the next-older version (undefined on either side = add/remove = a change).
async function scenarioCommits(root: string, headPath: string): Promise<Map<string, string[]>> {
  const versions = await fileVersions(root, headPath)
  const commits = new Map<string, string[]>()
  const push = (name: string, hash: string) => { const a = commits.get(name); if (a) a.push(hash); else commits.set(name, [hash]) }
  for (let i = 0; i < versions.length; i++) {
    const cur = versions[i].blocks
    const older = versions[i + 1]?.blocks ?? new Map<string, string>()
    for (const name of new Set([...cur.keys(), ...older.keys()])) {
      if (cur.get(name) !== older.get(name)) push(name, versions[i].hash)
    }
  }
  return commits
}

async function build(root: string, yatsuPaths: string[]): Promise<ScenarioIndex> {
  const idx: ScenarioIndex = new Map()
  const CONC = 8   // bound the git-show fan-out; the whole index is built once per HEAD then cached
  for (let i = 0; i < yatsuPaths.length; i += CONC) {
    const batch = yatsuPaths.slice(i, i + CONC)
    const done = await Promise.all(batch.map((p) => scenarioCommits(root, p)))
    batch.forEach((p, j) => idx.set(p, done[j]))
  }
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
