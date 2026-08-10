export type EvalReviewState = 'pass' | 'fail' | 'stalePass' | 'staleFail' | 'empty'

export type EvalReviewReading = {
  freshnessDeferred?: boolean
  scenario?: string
  verdict?: { status?: string }
  fresh?: boolean
}

export function evalReviewState(reading: EvalReviewReading | null | undefined): EvalReviewState
