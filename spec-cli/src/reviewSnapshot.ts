export type ReviewEvalNode = {
  id: string
  hue?: number
  scenarios: any[]
  evals: any[]
  readings: any[]
}

export type ReviewSnapshot = {
  issues: any[]
  evalNodes: ReviewEvalNode[]
}

let current: ReviewSnapshot | null = null

export function publishReviewSnapshot(snapshot: ReviewSnapshot): void {
  current = snapshot
}

export function readReviewSnapshot(): ReviewSnapshot {
  if (!current) throw new Error('review snapshot is unavailable before the first successful graph build')
  return current
}
