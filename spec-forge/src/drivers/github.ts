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

// @@@ github driver - the real, read-only driver behind the forge port. It READS the host (open issues +
// PRs) via `gh`; it does not project the graph out and does not write anything. The link resolution
// (which node an issue/PR serves) is NOT here — that's host-agnostic, in links.ts. This driver's only job
// is to fill the vendor-neutral ForgeIssue/ForgePR shapes from GitHub's JSON. `--limit 200` is generous
// for the open set; if a repo ever exceeds it the CLI surfaces the truncation, we don't silently cap.
export const githubDriver: ForgeDriver = {
  host: 'github',

  async listIssues(): Promise<ForgeIssue[]> {
    const rows = await gh<
      { number: number; title: string; body: string; url: string; state: string; labels: { name: string }[] }[]
    >(['issue', 'list', '--state', 'open', '--limit', '200', '--json', 'number,title,body,url,state,labels'])
    return rows.map((r) => ({
      number: r.number,
      title: r.title,
      body: r.body ?? '',
      url: r.url,
      state: r.state,
      labels: (r.labels ?? []).map((l) => l.name),
    }))
  },

  async listPRs(): Promise<ForgePR[]> {
    const rows = await gh<
      {
        number: number; title: string; url: string; state: string; headRefName: string
        closingIssuesReferences?: { number: number }[]
      }[]
    >(['pr', 'list', '--state', 'open', '--limit', '200', '--json', 'number,title,url,state,headRefName,closingIssuesReferences'])
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
