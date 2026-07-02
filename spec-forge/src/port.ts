// a forge issue's comment — the shape that becomes a unified Issue's Reply verbatim (author→by,
// createdAt→at, body→body), so both stores' threads are one thread type downstream.
export type ForgeComment = {
  author: string
  createdAt: string
  body: string
}

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
  // the discussion under it — rides the same reads (list/since), so the unified Issue port maps it
  // into replies[] with no second fetch path.
  comments: ForgeComment[]
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
  // the port's two write verbs — used solely by the unified Issue port (spec-cli issues.ts): promotion
  // creates an issue, a store-routed reply comments on one. The driver stays the only network toucher;
  // the tracer never calls either; node state is never touched.
  createIssue(input: { title: string; body: string }): Promise<{ number: number; url: string }>
  createComment(input: { number: number; body: string }): Promise<{ url: string }>
  // optional INCREMENTAL window — only issues whose updated-at ≥ sinceISO. A driver that offers it lets
  // the resident cache merge small deltas between periodic full reconciles instead of re-listing the
  // world every TTL; a driver without it simply always full-lists.
  listIssuesSince?(sinceISO: string): Promise<ForgeIssue[]>
}
