export type ForgeIssue = {
  number: number
  title: string
  body: string
  url: string
  state: string
  labels: string[]
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
