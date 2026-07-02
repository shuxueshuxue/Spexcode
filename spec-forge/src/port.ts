// a forge issue's comment — the same shape a forum reply collapses to ({by, at, body} in the unified
// Issue port), so both stores' threads render identically downstream.
export type ForgeComment = {
  author: string
  body: string
  createdAt: string
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
  // the issue's comment thread — becomes the unified Issue's replies[], so a forge discussion
  // reads exactly like a forum thread.
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
  // one issue's comment thread — the targeted read the incremental window and the post-write refresh
  // use (a comment bumps an issue's updated-at, so the window sees WHICH issues changed but not their
  // new comments; this fetches them).
  listComments(number: number): Promise<ForgeComment[]>
  // the port's TWO write verbs — used solely by the unified Issue port (spec-cli issues.ts): createIssue
  // by promotion, createComment by the store-routed reply. The driver stays the only network toucher;
  // the tracer never calls either; node state is never touched.
  createIssue(input: { title: string; body: string }): Promise<{ number: number; url: string }>
  createComment(input: { number: number; body: string }): Promise<{ url: string }>
  // optional INCREMENTAL window — only issues whose updated-at ≥ sinceISO. A driver that offers it lets
  // the resident cache merge small deltas between periodic full reconciles instead of re-listing the
  // world every TTL; a driver without it simply always full-lists.
  listIssuesSince?(sinceISO: string): Promise<ForgeIssue[]>
}
