import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { ForgeDriver, ForgeIssue, ForgePR } from '../port.js'

const run = promisify(execFile)

// maxBuffer is raised above the 1MB default: a busy repo's issue/PR JSON can exceed it
async function gh<T>(args: string[]): Promise<T> {
  const { stdout } = await run('gh', args, { maxBuffer: 16 * 1024 * 1024 })
  return JSON.parse(stdout) as T
}

export const githubDriver: ForgeDriver = {
  host: 'github',

  // fetch open and closed in separate `--limit 200` windows and merge, so a flood of closed issues can't crowd the open set out of one shared `--state all` limit
  async listIssues(): Promise<ForgeIssue[]> {
    const list = (state: string) =>
      gh<{ number: number; title: string; body: string; url: string; state: string; labels: { name: string }[]; author: { login: string } | null; createdAt: string }[]>(
        ['issue', 'list', '--state', state, '--limit', '200', '--json', 'number,title,body,url,state,labels,author,createdAt'],
      )
    const [open, closed] = await Promise.all([list('open'), list('closed')])
    return [...open, ...closed].map((r) => ({
      number: r.number,
      title: r.title,
      body: r.body ?? '',
      url: r.url,
      state: (r.state || '').toLowerCase(),   // one canonical casing at the adapter (gh GraphQL says OPEN, REST says open)
      labels: (r.labels ?? []).map((l) => l.name),
      author: r.author?.login ?? '',
      createdAt: r.createdAt ?? '',
    }))
  },

  // the INCREMENTAL window: only issues updated since `sinceISO` (GitHub REST honors `since` = updated-at),
  // paged manually (100/page, stop on a short page — an incremental window is normally one page). PRs ride
  // the same REST endpoint flagged with `pull_request` and are filtered out — the PR list keeps its own path.
  async listIssuesSince(sinceISO: string): Promise<ForgeIssue[]> {
    type ApiRow = {
      number: number; title: string; body: string | null; html_url: string; state: string
      labels: ({ name?: string } | string)[]; user: { login: string } | null; created_at: string
      pull_request?: unknown
    }
    const out: ApiRow[] = []
    for (let page = 1; page <= 20; page++) {
      const rows = await gh<ApiRow[]>(['api', `repos/{owner}/{repo}/issues?state=all&since=${encodeURIComponent(sinceISO)}&per_page=100&page=${page}`])
      out.push(...rows)
      if (rows.length < 100) break
    }
    return out.filter((r) => !r.pull_request).map((r) => ({
      number: r.number,
      title: r.title,
      body: r.body ?? '',
      url: r.html_url,
      state: (r.state || '').toLowerCase(),
      labels: (r.labels ?? []).map((l) => (typeof l === 'string' ? l : l.name ?? '')).filter(Boolean),
      author: r.user?.login ?? '',
      createdAt: r.created_at ?? '',
    }))
  },

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

  // the port's one write verb (promotion — see port.ts). `gh issue create` prints the new issue's URL on
  // stdout; the number is its last path segment. Fails loud like every other driver call.
  async createIssue({ title, body }: { title: string; body: string }): Promise<{ number: number; url: string }> {
    const { stdout } = await run('gh', ['issue', 'create', '--title', title, '--body', body], { maxBuffer: 1024 * 1024 })
    const url = stdout.trim().split('\n').pop() ?? ''
    const number = parseInt(url.split('/').pop() ?? '', 10)
    if (!url.startsWith('http') || !Number.isFinite(number)) throw new Error(`gh issue create returned an unexpected result: ${stdout.trim()}`)
    return { number, url }
  },
}

function isUnknownFieldError(err: unknown): boolean {
  const e = err as { stderr?: string; message?: string }
  const text = `${e?.stderr ?? ''}\n${e?.message ?? ''}`
  return /unknown json field/i.test(text)
}

let warnedNoTransitive = false
function warnNoTransitiveOnce(): void {
  if (warnedNoTransitive) return
  warnedNoTransitive = true
  console.warn(
    'spec-forge: this `gh` is too old for `closingIssuesReferences` — transitive issue↔PR links are ' +
      'disabled (branch + `Spec:` marker links still work). Upgrade `gh` to restore them.',
  )
}
