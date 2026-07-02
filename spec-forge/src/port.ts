export type ForgeIssue = {
  number: number
  title: string
  body: string
  url: string
  state: string
  labels: string[]
  // who opened it and when — what lets a forge issue stand beside a forum thread as the same
  // object in the unified Issue port (spec-cli issues.ts) with a `by` and a `created`.
  author: string
  createdAt: string
}

export type ForgePR = {
  number: number
  title: string
  url: string
  state: string
  headRefName: string
  closesIssues: number[]
}

export interface ForgeDriver {
  readonly host: string
  listIssues(): Promise<ForgeIssue[]>
  listPRs(): Promise<ForgePR[]>
  // the port's ONE write verb — used solely by the unified Issue port's promotion (spec-cli issues.ts),
  // so the driver stays the only network toucher. The tracer never calls it; node state is never touched.
  createIssue(input: { title: string; body: string }): Promise<{ number: number; url: string }>
  // optional INCREMENTAL window — only issues whose updated-at ≥ sinceISO. A driver that offers it lets
  // the resident cache merge small deltas between periodic full reconciles instead of re-listing the
  // world every TTL; a driver without it simply always full-lists.
  listIssuesSince?(sinceISO: string): Promise<ForgeIssue[]>
}
