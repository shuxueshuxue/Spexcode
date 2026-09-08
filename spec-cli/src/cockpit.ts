import { reviewPayload, type ReviewPayload } from './session-review.js'

export type CockpitReview = ReviewPayload

export async function cockpitReview(id: string): Promise<CockpitReview | null> {
  return reviewPayload(id)
}
