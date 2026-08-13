export type Reply = {
  by: string
  at: string
  body: string
  rid?: string
  targetCodeSha?: string
  resolved?: boolean
  resolvedAt?: string
  resolvedBy?: string
}

export type Issue = {
  id: string
  store: string
  concern: string
  by: string
  status: string
  nodes: string[]
  created: string
  body: string
  replies: Reply[]
  evidence: string[]
  labels: unknown[]
  url?: string
}

export type RemarkTrack = {
  threadId: string
  node: string
  scenario: string
  thread: Issue
  remarks: Reply[]
}
