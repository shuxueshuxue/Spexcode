import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ForgeDriver, ForgeIssue, ForgePR } from '../port.js'

const run = promisify(execFile)

// @@@ gh - run the GitHub CLI and parse its JSON. `gh` is the ONLY network/auth surface spec-forge
// touches: it already carries the user's auth and auto-detects the repo from the cwd's git remote, so we
// add no token handling of our own. Fail LOUD — a missing/unauthenticated `gh` throws here with gh's own
// message rather than being swallowed into an empty list (an empty forge and a broken `gh` must not look
// the same). maxBuffer is raised because a busy repo's issue/PR JSON can exceed the 1MB default.
async function gh<T>(args: string[]): Promise<T> {
  const { stdout } = await run('gh', args, { maxBuffer: 16 * 1024 * 1024 })
  return JSON.parse(stdout) as T
}

// @@@ github driver - the real, read-only driver behind the forge port. It READS the host (issues + open
// PRs) via `gh`; it does not project the graph out and does not write anything. The link resolution
// (which node an issue/PR serves) is NOT here — that's host-agnostic, in links.ts. This driver's only job
// is to fill the vendor-neutral ForgeIssue/ForgePR shapes from GitHub's JSON. `--limit 200` is generous
// for either set; if a repo ever exceeds it the CLI surfaces the truncation, we don't silently cap.
export const githubDriver: ForgeDriver = {
  host: 'github',

  // @@@ open + closed - fetch the two states SEPARATELY (each its own 200 window) and merge, so a flood of
  // closed issues can never crowd the open set out of a single `--state all` limit. Both feed the node-info
  // Issues tab (open and closed alike); the board derives the glance badge/popover from the open subset.
  async listIssues(): Promise<ForgeIssue[]> {
    const list = (state: string) =>
      gh<{ number: number; title: string; body: string; url: string; state: string; labels: { name: string }[] }[]>(
        ['issue', 'list', '--state', state, '--limit', '200', '--json', 'number,title,body,url,state,labels'],
      )
    const [open, closed] = await Promise.all([list('open'), list('closed')])
    return [...open, ...closed].map((r) => ({
      number: r.number,
      title: r.title,
      body: r.body ?? '',
      url: r.url,
      state: r.state,
      labels: (r.labels ?? []).map((l) => l.name),
    }))
  },

  // @@@ best-effort transitive - `closingIssuesReferences` powers the TRANSITIVE link (issue ← PR → node),
  // one of three sources and the only one needing a special field. The two CORE links (a `node/<id>` PR
  // branch via headRefName, an issue-body `Spec:` marker) need nothing beyond the baseline fields, so an
  // older `gh` that lacks this one JSON field must degrade ONLY transitive linking — it must not take the
  // whole forge down (which `resident.ts` would then swallow into a no-badge, no-error blank). So: ask for
  // the field, and ONLY on gh's specific "unknown JSON field" rejection retry without it (closesIssues
  // empty). A real failure (no `gh`, no auth, no repo) is a different error and still throws LOUD.
  async listPRs(): Promise<ForgePR[]> {
    type Row = {
      number: number; title: string; url: string; state: string; headRefName: string
      closingIssuesReferences?: { number: number }[]
    }
    const base = ['pr', 'list', '--state', 'open', '--limit', '200', '--json']
    const fields = 'number,title,url,state,headRefName'
    let rows: Row[]
    try {
      rows = await gh<Row[]>([...base, `${fields},closingIssuesReferences`])
    } catch (err) {
      if (!isUnknownFieldError(err)) throw err
      warnNoTransitiveOnce()
      rows = await gh<Row[]>([...base, fields])
    }
    return rows.map((r) => ({
      number: r.number,
      title: r.title,
      url: r.url,
      state: r.state,
      headRefName: r.headRefName,
      closesIssues: (r.closingIssuesReferences ?? []).map((c) => c.number),
    }))
  },
}

// @@@ isUnknownFieldError - the narrow signal that THIS `gh` is too old for an enrichment field (it lists
// the fields it does know and exits non-zero). Matched on gh's own message so only a field-version mismatch
// triggers the degrade; auth/repo/network errors carry different text and fall through to a loud throw.
function isUnknownFieldError(err: unknown): boolean {
  const e = err as { stderr?: string; message?: string }
  const text = `${e?.stderr ?? ''}\n${e?.message ?? ''}`
  return /unknown json field/i.test(text)
}

// @@@ warnNoTransitiveOnce - surface the lost capability ONCE (not per reconcile, which would spam every
// 60s board poll). Capability loss is exposed, not hidden: the core links still work, only the free
// transitive link is unavailable until `gh` is new enough.
let warnedNoTransitive = false
function warnNoTransitiveOnce(): void {
  if (warnedNoTransitive) return
  warnedNoTransitive = true
  console.warn(
    'spec-forge: this `gh` is too old for `closingIssuesReferences` — transitive issue↔PR links are ' +
      'disabled (branch + `Spec:` marker links still work). Upgrade `gh` to restore them.',
  )
}
