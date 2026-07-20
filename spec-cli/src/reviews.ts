import { createHash } from 'node:crypto'
import { loadSpecsLite } from './specs.js'
import { mergedIssues } from './issues.js'
import { listSessions } from './sessions.js'
import { getBoard } from './graphCache.js'
import { residentForgeState } from '../../spec-forge/src/resident.js'
import { resolveForgeHost } from '../../spec-forge/src/drivers.js'
import { buildSessionEvals, type SessionEvals } from '../../spec-eval/src/sessioneval.js'
import { issuesEnabled as issuesEnabledForReview } from './localIssues.js'
import { issueStores as issueStoresForReview } from './issues.js'
// @ts-expect-error The dashboard module is deliberately plain JS so the browser and server execute the
// exact same tokenizer/matcher. It is shipped beside the built dashboard by the root package manifest.
import { EVAL_FILTER_KIND, evalFilterModel, evalReviewState, issueFilterModel, tokenFilterState } from '../../spec-dashboard/src/reviewFilters.js'
// @ts-expect-error See the shared-domain note above.
import { EVAL_QUERY_DEFAULT, ISSUE_QUERY_DEFAULT, readToken } from '../../spec-dashboard/src/reviewQuery.js'

export const REVIEW_PER_PAGE = 25

type ReviewItem = Record<string, unknown>
type ReviewOption = { value: string; label?: string; count?: number }
type ReviewFacet = { key: string; value: string; options: ReviewOption[] }

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
  counts: Record<string, number>
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
      value: String(facet.value ?? ''),
      options: (facet.options ?? []).map((option: any) => ({
        value: String(option.value ?? ''),
        ...(option.label != null ? { label: String(option.label) } : {}),
        ...(Number.isFinite(option.count) ? { count: Number(option.count) } : {}),
      })),
    }]
  })) as Record<string, ReviewFacet>
  const section = model.section ? {
    key: String(model.section.key),
    value: String(model.section.value ?? ''),
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
    revision: revisionOf(revisionInputs),
    ...responseModel(model),
  }
}

const issueOrder = (a: any, b: any): number => String(b.created ?? '').localeCompare(String(a.created ?? ''))
  || String(a.id ?? '').localeCompare(String(b.id ?? ''))

export async function issuesReview(query: string | undefined, requestedPage: unknown) {
  const sessions = await listSessions()
  const issues = mergedIssues(
    { host: resolveForgeHost(), state: residentForgeState() },
    loadSpecsLite().map((spec) => spec.id),
  ).slice().sort(issueOrder)
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

const byNewest = (a: any, b: any): number => String(b.ts ?? '').localeCompare(String(a.ts ?? ''))
  || String(a.node ?? '').localeCompare(String(b.node ?? ''))
  || String(a.scenario ?? '').localeCompare(String(b.scenario ?? ''))

export function trunkEvalReviewItems(nodes: any[]): ReviewItem[] {
  const items: any[] = []
  for (const node of nodes ?? []) {
    const latest = new Map<string, any>()
    for (const reading of node.evals ?? []) if (!latest.has(reading.scenario)) latest.set(reading.scenario, reading)
    for (const scenario of node.scenarios ?? []) {
      const reading = latest.get(scenario.name)
      if (!reading) continue
      items.push({
        ...reading,
        expected: scenario.expected ?? reading.expected,
        state: evalReviewState(reading),
        node: node.id,
        hue: node.hue,
        filterKind: EVAL_FILTER_KIND.RESULT,
      })
    }
  }
  return items.sort(byNewest)
}

export function scopedEvalReviewItems(model: SessionEvals): ReviewItem[] {
  const blind: any[] = []
  const own: any[] = []
  const inherited: any[] = []
  for (const node of model.nodes ?? []) {
    const latest = new Map<string, any>()
    for (const reading of node.evals ?? []) if (!latest.has(reading.scenario)) latest.set(reading.scenario, reading)
    for (const scenario of node.scenarios ?? []) {
      const reading = latest.get(scenario.name)
      if (!reading) {
        blind.push({
          scenario: scenario.name,
          expected: scenario.expected,
          impact: scenario.impact,
          node: node.id,
          hue: node.hue,
          filterKind: EVAL_FILTER_KIND.BLIND,
        })
        continue
      }
      const item = {
        ...reading,
        expected: scenario.expected ?? reading.expected,
        state: evalReviewState(reading),
        node: node.id,
        hue: node.hue,
        filterKind: EVAL_FILTER_KIND.RESULT,
      }
      ;(reading.inSession ? own : inherited).push(item)
    }
  }
  return [...blind, ...own.sort(byNewest), ...inherited.sort(byNewest)]
}

export async function evalsReview(query: string | undefined, requestedPage: unknown) {
  const text = String(query ?? '').trim() || EVAL_QUERY_DEFAULT
  const scope = readToken(text, 'scope') || null
  if (scope) {
    const model = await buildSessionEvals(scope)
    if (!model) return null
    const items = scopedEvalReviewItems(model)
    const sessions = await listSessions()
    const filtered = evalFilterModel(items, tokenFilterState(text, 'eval'), { sessions, defaultKind: 'all', defaultSection: '' })
    return {
      scope,
      gates: model.gates,
      unknown: model.nodes.reduce((count, node) => count + (node.unknownCoverage?.length ?? 0), 0),
      ...paginateReview(items, filtered.shown, filtered, requestedPage, {
        domain: 'evals', scope, items, gates: model.gates, sessions: sessions.map((session) => session.id),
      }),
    }
  }
  const board = await getBoard()
  const items = trunkEvalReviewItems(board.nodes)
  const filtered = evalFilterModel(items, tokenFilterState(text, 'eval'), { sessions: board.sessions, defaultKind: 'all', defaultSection: '' })
  return {
    scope: null,
    gates: [],
    unknown: 0,
    ...paginateReview(items, filtered.shown, filtered, requestedPage, {
      domain: 'evals', items, sessions: board.sessions.map((session) => session.id),
    }),
  }
}
