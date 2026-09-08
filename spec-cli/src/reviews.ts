import { createHash } from 'node:crypto'
import { listSessions } from './sessions.js'
import { getBoard, getBoardForIssueSource } from './graphCache.js'
import { issuesEnabled as issuesEnabledForReview, localIssueRevision } from './localIssues.js'
import { issueStores as issueStoresForReview } from './issues.js'
import { hasReviewSnapshot, issueSourceCurrent, readReviewSnapshot } from '@spexcode/spec-core'
import { residentForgeRevision, residentForgeState } from '@spexcode/spec-forge/resident'
import { issueFilterModel, tokenFilterState } from '@spexcode/spec-core/review'
import { ISSUE_QUERY_DEFAULT } from '@spexcode/spec-core/review'

export const REVIEW_PER_PAGE = 25

type ReviewItem = Record<string, unknown>
// A section count is one number, or — when the domain adapter splits that section — its named buckets,
// which re-add to the same whole population ([[review-filters]] owns the split; Evals splits its measured
// verdicts into {fresh,stale} so the remeasurement debt travels with the count instead of being recomputed
// per surface). The fold happens ONCE, here on the server, over the complete filtered population.
export type ReviewCount = number | Record<string, number>
type ReviewOption = { value: string; label?: string; count?: number }
type ReviewFacet = { key: string; label?: string; value: string; meaningful?: boolean; options: ReviewOption[] }

export type PagedReview<T extends ReviewItem = ReviewItem> = {
  items: T[]
  page: number
  perPage: number
  total: number
  sourceTotal: number
  pageCount: number
  prev: number | null
  next: number | null
  revision: string
  counts: Record<string, ReviewCount>
  facets: Record<string, ReviewFacet>
  section: { key: string; value: string; options: ReviewOption[] } | null
}

const revisionOf = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')

export function reviewPageNumber(value: unknown): number {
  const raw = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : Number.NaN
  return Number.isSafeInteger(raw) && raw > 0 ? raw : 1
}

function responseModel(model: any): Pick<PagedReview, 'counts' | 'facets' | 'section'> {
  const facets = Object.fromEntries(Object.entries(model.facets ?? {}).map(([key, raw]) => {
    const facet = raw as any
    return [key, {
      key,
      ...(facet.label != null ? { label: String(facet.label) } : {}),
      value: String(facet.value ?? ''),
      ...(facet.meaningful != null ? { meaningful: !!facet.meaningful } : {}),
      options: (facet.options ?? []).map((option: any) => ({
        value: String(option.value ?? ''),
        ...(option.label != null ? { label: String(option.label) } : {}),
        ...(Number.isFinite(option.count) ? { count: Number(option.count) } : {}),
      })),
    }]
  })) as Record<string, ReviewFacet>
  const section = model.section ? {
    key: String(model.section.key),
    ...(model.section.label != null ? { label: String(model.section.label) } : {}),
    value: String(model.section.value ?? ''),
    ...(model.section.meaningful != null ? { meaningful: !!model.section.meaningful } : {}),
    options: (model.section.options ?? []).map((option: any) => ({
      value: String(option.value ?? ''),
      ...(option.label != null ? { label: String(option.label) } : {}),
      ...(Number.isFinite(option.count) ? { count: Number(option.count) } : {}),
    })),
  } : null
  return { counts: { ...(model.sections ?? {}) }, facets, section }
}

export function paginateReview<T extends ReviewItem>(
  source: T[],
  shown: T[],
  model: any,
  requestedPage: unknown,
  revisionInputs: unknown,
): PagedReview<T> {
  const page = reviewPageNumber(requestedPage)
  const total = shown.length
  const pageCount = Math.ceil(total / REVIEW_PER_PAGE)
  const start = (page - 1) * REVIEW_PER_PAGE
  const overflow = pageCount > 0 ? page > pageCount : page > 1
  return {
    items: shown.slice(start, start + REVIEW_PER_PAGE),
    page,
    perPage: REVIEW_PER_PAGE,
    total,
    sourceTotal: source.length,
    pageCount,
    prev: page > 1 ? page - 1 : null,
    next: page < pageCount || overflow ? page + 1 : null,
    revision: revisionOf({ page, source: revisionInputs }),
    ...responseModel(model),
  }
}

const issueOrder = (a: any, b: any): number => String(b.created ?? '').localeCompare(String(a.created ?? ''))
  || String(a.id ?? '').localeCompare(String(b.id ?? ''))

export async function issuesReview(query: string | undefined, requestedPage: unknown) {
  // The first request must wait for the first atomic publication. Once one exists, a graph refresh may be
  // rebuilding unrelated board/session state; the published review source remains a valid answer and its
  // revision/poll path will deliver the next generation without making this page join that flight.
  // A newer revision on ANY issue store is a different thing entirely — it is a source change this page is
  // about, so the read waits for a publication that contains it. Every store is asked, because a store left
  // out of this comparison is a store whose writes this page cannot see: a local close stayed invisible in
  // the list until some unrelated graph build happened to republish.
  residentForgeState()
  const required = { forge: residentForgeRevision(), local: localIssueRevision() }
  if (!hasReviewSnapshot()) await getBoard()
  else if (!issueSourceCurrent(readReviewSnapshot().issueSource, required)) {
    await getBoardForIssueSource(required)
  }
  const sessions = await listSessions()
  const issues = readReviewSnapshot().issues.slice().sort(issueOrder)
  const text = String(query ?? '').trim() || ISSUE_QUERY_DEFAULT
  const model = issueFilterModel(issues, tokenFilterState(text, 'issue'), { sessions, defaultSection: '' })
  return {
    enabled: issuesEnabledForReview(),
    stores: issueStoresForReview(),
    ...paginateReview(issues, model.shown, model, requestedPage, {
      domain: 'issues', issues, sessions: sessions.map((session) => session.id),
    }),
  }
}
