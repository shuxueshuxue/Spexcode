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
}
