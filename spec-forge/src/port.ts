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
  author: string
  createdAt: string
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
  createIssue(input: { title: string; body: string }): Promise<{ number: number; url: string }>
  createComment(input: { number: number; body: string }): Promise<{ url: string }>
  closeIssue(input: { number: number }): Promise<{ url: string }>
  listIssuesSince?(sinceISO: string): Promise<ForgeIssue[]>
}
