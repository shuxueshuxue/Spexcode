export type ReviewEvalNode = {
  id: string
  hue?: number
  scenarios: any[]
  evals: any[]
  readings: any[]
}

// The content revision of every source the Issue read merges, ONE number per store. A single carrier
// cannot express this: a store whose write bumped nothing is a store the reader is blind to, and folding
// the stores into one counter lets a newer revision on one of them pay for a missed write on another.
export type IssueSourceRevision = {
  forge: number
  local: number
}

export type ReviewSnapshot = {
  issues: any[]
  evalNodes: ReviewEvalNode[]
  issueSource: IssueSourceRevision
}

// The one place that decides "the published generation is new enough to answer": EVERY carrier must have
// reached at least what the request requires. Kept beside the type so a reader and the fence that waits on
// it cannot drift into two different notions of current.
export function issueSourceCurrent(published: IssueSourceRevision, required: IssueSourceRevision): boolean {
  return published.forge >= required.forge && published.local >= required.local
}

let current: ReviewSnapshot | null = null

export function publishReviewSnapshot(snapshot: ReviewSnapshot): void {
  current = snapshot
}

export function readReviewSnapshot(): ReviewSnapshot {
  if (!current) throw new Error('review snapshot is unavailable before the first successful graph build')
  return current
}

export function hasReviewSnapshot(): boolean {
  return current !== null
}
