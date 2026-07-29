import { execFileSync } from 'node:child_process'
import type { ForgeComment, ForgeDriver, ForgeIssue, ForgePR } from '../port.js'

type Ctx = { base: string; host: string; project: string; token: string }
let ctx: Ctx | null = null

function gitlabCtx(): Ctx {
  if (ctx) return ctx
  const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim()
  const parsed = parseRemote(remote)
  if (!parsed) throw new Error(`gitlab: cannot parse origin remote '${remote}' as a GitLab URL`)
  const token = process.env.GITLAB_TOKEN || credentialToken(parsed.host)
  if (!token) {
    throw new Error(
      `gitlab: no token for ${parsed.host} — set GITLAB_TOKEN, or store a PAT in git's credential store:\n` +
        `  printf "protocol=https\\nhost=${parsed.host}\\nusername=<user>\\npassword=<token>\\n\\n" | git credential approve`,
    )
  }
  ctx = { ...parsed, token }
  return ctx
}

export function parseRemote(remote: string): { base: string; host: string; project: string } | null {
  let m = remote.match(/^(https?:\/\/[^/]+)\/(.+?)(?:\.git)?\/?$/)
  if (m) return { base: m[1], host: m[1].replace(/^https?:\/\//, ''), project: m[2] }
  m = remote.match(/^(?:ssh:\/\/)?[\w.-]+@([\w.-]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/)
  if (m) return { base: `https://${m[1]}`, host: m[1], project: m[2] }
  return null
}

function credentialToken(host: string): string {
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      input: `protocol=https\nhost=${host}\n\n`,
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'true' },
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    return out.match(/^password=(.+)$/m)?.[1] ?? ''
  } catch {
    return ''
  }
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const { base, project, token } = gitlabCtx()
  const sep = path.includes('?') ? '&' : '?'
  const url = `${base}/api/v4/projects/${encodeURIComponent(project)}/${path}${init?.method ? '' : `${sep}per_page=100`}`
  const res = await fetch(url, {
    ...init,
    headers: { 'PRIVATE-TOKEN': token, 'content-type': 'application/json', ...init?.headers },
  })
  if (!res.ok) throw new Error(`gitlab: ${init?.method ?? 'GET'} ${path} → ${res.status} ${(await res.text()).slice(0, 300)}`)
  return (await res.json()) as T
}

// GitLab's API has no bounded list query; stop at a short page and cap the walk.
async function paged<T>(path: string): Promise<T[]> {
  const sep = path.includes('?') ? '&' : '?'
  const out: T[] = []
  for (let page = 1; page <= 20; page++) {
    const rows = await api<T[]>(`${path}${sep}page=${page}`)
    out.push(...rows)
    if (rows.length < 100) break
  }
  return out
}

type ApiIssue = {
  iid: number; title: string; description: string | null; web_url: string; state: string
  labels: string[]; author: { username: string } | null; created_at: string; user_notes_count: number
}

async function toIssue(r: ApiIssue): Promise<ForgeIssue> {
  return {
    number: r.iid,
    title: r.title,
    body: r.description ?? '',
    url: r.web_url,
    state: normalizeState(r.state),
    labels: r.labels ?? [],
    author: r.author?.username ?? '',
    createdAt: r.created_at ?? '',
    comments: r.user_notes_count > 0 ? await listNotes(r.iid) : [],
  }
}

function normalizeState(state: string): string {
  const s = (state || '').toLowerCase()
  return s === 'opened' ? 'open' : s
}

async function listNotes(iid: number): Promise<ForgeComment[]> {
  type Note = { system: boolean; author: { username: string } | null; created_at: string; body: string | null }
  const rows = await paged<Note>(`issues/${iid}/notes`)
  return rows
    .filter((n) => !n.system)
    .map((n) => ({ author: n.author?.username ?? '', createdAt: n.created_at ?? '', body: n.body ?? '' }))
}

export const gitlabDriver: ForgeDriver = {
  host: 'gitlab',

  async listIssues(): Promise<ForgeIssue[]> {
    const rows = await paged<ApiIssue>('issues?state=all')
    return Promise.all(rows.map(toIssue))
  },

  async listIssuesSince(sinceISO: string): Promise<ForgeIssue[]> {
    const rows = await paged<ApiIssue>(`issues?state=all&updated_after=${encodeURIComponent(sinceISO)}`)
    return Promise.all(rows.map(toIssue))
  },

  async listPRs(): Promise<ForgePR[]> {
    type ApiMR = { iid: number; title: string; web_url: string; state: string; source_branch: string }
    const rows = await paged<ApiMR>('merge_requests?state=opened')
    return Promise.all(
      rows.map(async (r) => ({
        number: r.iid,
        title: r.title,
        url: r.web_url,
        state: normalizeState(r.state),
        headRefName: r.source_branch,
        closesIssues: (await paged<{ iid: number }>(`merge_requests/${r.iid}/closes_issues`)).map((i) => i.iid),
      })),
    )
  },

  async createIssue({ title, body }: { title: string; body: string }): Promise<{ number: number; url: string }> {
    const r = await api<{ iid: number; web_url: string }>('issues', {
      method: 'POST',
      body: JSON.stringify({ title, description: body }),
    })
    if (!r.web_url?.startsWith('http') || !Number.isFinite(r.iid)) throw new Error(`gitlab: issue create returned an unexpected result: ${JSON.stringify(r)}`)
    return { number: r.iid, url: r.web_url }
  },

  async createComment({ number, body }: { number: number; body: string }): Promise<{ url: string }> {
    const { base, project } = gitlabCtx()
    const r = await api<{ id: number }>(`issues/${number}/notes`, { method: 'POST', body: JSON.stringify({ body }) })
    if (!Number.isFinite(r.id)) throw new Error(`gitlab: note create returned an unexpected result: ${JSON.stringify(r)}`)
    return { url: `${base}/${project}/-/issues/${number}#note_${r.id}` }
  },

  async closeIssue({ number }: { number: number }): Promise<{ url: string }> {
    const r = await api<{ web_url: string; state: string }>(`issues/${number}`, {
      method: 'PUT',
      body: JSON.stringify({ state_event: 'close' }),
    })
    if (!r.web_url?.startsWith('http')) throw new Error(`gitlab: issue close returned an unexpected result: ${JSON.stringify(r)}`)
    return { url: r.web_url }
  },
}
