import { execFileSync } from 'node:child_process'
import { relative } from 'node:path'
import { materialize, stripSpexcodeBlock, GENERATED_MARK } from './materialize.js'
import { HARNESSES } from './harness.js'

// GIT ENV, deliberately INVERTED from git.ts's git(): every call here PRESERVES the hook's environment —
// GIT_INDEX_FILE must be honored so the surgery reads/writes the EXACT index this commit is being built
// from (a `git commit <path>` pathspec commit and `git commit -a` both run hooks against a TEMPORARY index;
// operating on the real one would silently miss them). git.ts strips that env for repo DISCOVERY reasons;
// index surgery is the one place the env is the point.
const raw = (args: string[], input?: string): string =>
  execFileSync('git', args, { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })

function inHead(p: string): boolean {
  try { raw(['cat-file', '-e', `HEAD:${p}`]); return true } catch { return false }
}
function stagedBlob(p: string): string | null {
  try { return raw(['show', `:${p}`]) } catch { return null }
}
function evict(p: string, why: string): void {
  raw(['update-index', '--force-remove', '--', p])
  console.error(`spexcode: unstaged ${p} (${why} — generated artifacts are never tracked; the file stays on disk)`)
}
function replaceBlob(p: string, content: string): void {
  const stage = raw(['ls-files', '--stage', '--', p]).trim()          // "100644 <sha> 0\t<p>"
  const mode = stage.split(/\s/)[0] || '100644'
  const sha = raw(['hash-object', '-w', '--stdin'], content).trim()
  raw(['update-index', '--cacheinfo', `${mode},${sha},${p}`])
  console.error(`spexcode: stripped the <!-- spexcode --> block from staged ${p} (the block is working-tree context, never history)`)
}

export function commitSurgery(proj = process.cwd()): void {
  // (1) unconditional materialize — machine-fixable state (exclude entries, filter binding, kind flips)
  // is repaired BEFORE the index is inspected, so the inspection below judges against fresh masks.
  try { materialize(proj) } catch (e) {
    console.error(`spexcode: pre-commit materialize failed (${(e as Error).message}) — footprint may be stale this commit`)
  }
  const staged = raw(['diff', '--cached', '--name-only', '-z']).split('\0').filter(Boolean)
  if (!staged.length) return
  const rel = (f: string) => relative(proj, f)
  const contracts = new Set(HARNESSES.flatMap((h) => h.contractFiles(proj)).map(rel))
  const machine = new Set<string>(['spexcode.local.json', '.session'])
  for (const h of HARNESSES) {
    machine.add(rel(h.shimFile(proj)))
    const a = h.worktreeHookAnchor(proj)
    if (a) machine.add(rel(a))
  }
  const generatedDirs = HARNESSES.flatMap((h) => [h.skillDir(proj), h.agentDir(proj)])
    .filter((d): d is string => !!d).map((d) => `${rel(d)}/`)
  for (const p of staged) {
    if (contracts.has(p)) {
      const blob = stagedBlob(p)
      if (blob === null) continue
      const stripped = stripSpexcodeBlock(blob)
      if (stripped === blob) continue                               // no block staged — clean already did its job
      if (!stripped.trim() && !inHead(p)) evict(p, 'wholly a spexcode materialized artifact')
      else replaceBlob(p, stripped)
    } else if (machine.has(p) || p.startsWith('.worktrees/')) {
      if (!inHead(p)) evict(p, 'a machine-local spexcode file')
      else console.error(`spexcode: ${p} is a machine-local spexcode file but HEAD already tracks it — not touching a tracked file; untrack it yourself (git rm --cached ${p})`)
    } else if (generatedDirs.some((d) => p.startsWith(d))) {
      if (inHead(p)) continue                                       // historically tracked — the host's call
      const blob = stagedBlob(p)
      if (blob !== null && blob.includes(GENERATED_MARK)) evict(p, 'a generated skill/agent artifact')
    }
  }
}
