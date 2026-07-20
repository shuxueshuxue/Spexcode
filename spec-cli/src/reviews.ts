import { createHash } from 'node:crypto'
import { listSessions } from './sessions.js'
import { getBoard } from './graphCache.js'
import { buildSessionEvals, type SessionEvals } from '../../spec-eval/src/sessioneval.js'
import { evalTimeline } from '../../spec-eval/src/evaltab.js'
import { issuesEnabled as issuesEnabledForReview } from './localIssues.js'
import { issueStores as issueStoresForReview } from './issues.js'
import { readReviewSnapshot } from './reviewSnapshot.js'
// @ts-expect-error The dashboard module is deliberately plain JS so the browser and server execute the
// exact same tokenizer/matcher. It is shipped beside the built dashboard by the root package manifest.
import { EVAL_FILTER_KIND, evalFilterModel, evalReviewState, issueFilterModel, tokenFilterState } from '../../spec-dashboard/src/reviewFilters.js'
// @ts-expect-error See the shared-domain note above.
import { EVAL_QUERY_DEFAULT, ISSUE_QUERY_DEFAULT, readToken } from '../../spec-dashboard/src/reviewQuery.js'

export const REVIEW_PER_PAGE = 25

type ReviewItem = Record<string, unknown>
type ReviewOption = { value: string; label?: string; count?: number }
type ReviewFacet = { key: string; label?: string; value: string; meaningful?: boolean; options: ReviewOption[] }
type EvalNeighbor = { node: string; scenario: string; state: string }

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

export type EvalDetailReview = {
  scope: string | null
  selected: ReviewItem | null
  history: ReviewItem[]
  neighbors: {
    prev: EvalNeighbor[]
    next: EvalNeighbor[]
    total: number
    index: number | null
    order: 'default'
  }
  revision: string
  summary?: SessionEvals['summary']
  evalRevision?: SessionEvals['evalRevision']
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
    revision: revisionOf(revisionInputs),
    ...responseModel(model),
  }
}

const issueOrder = (a: any, b: any): number => String(b.created ?? '').localeCompare(String(a.created ?? ''))
  || String(a.id ?? '').localeCompare(String(b.id ?? ''))

export async function issuesReview(query: string | undefined, requestedPage: unknown) {
  const [, sessions] = await Promise.all([getBoard(), listSessions()])
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

const byNewest = (a: any, b: any): number => String(b.ts ?? '').localeCompare(String(a.ts ?? ''))
  || String(a.node ?? '').localeCompare(String(b.node ?? ''))
  || String(a.scenario ?? '').localeCompare(String(b.scenario ?? ''))

export function trunkEvalReviewItems(nodes: any[]): ReviewItem[] {
  const blind: any[] = []
  const items: any[] = []
  for (const node of nodes ?? []) {
    const latest = new Map<string, any>()
    for (const reading of node.evals ?? []) if (!latest.has(reading.scenario)) latest.set(reading.scenario, reading)
    for (const scenario of node.scenarios ?? []) {
      const reading = latest.get(scenario.name)
      if (!reading) {
        blind.push({
          scenario: scenario.name,
          expected: scenario.expected,
          tags: scenario.tags,
          node: node.id,
          hue: node.hue,
          filterKind: EVAL_FILTER_KIND.BLIND,
        })
        continue
      }
      items.push({
        ...reading,
        expected: scenario.expected ?? reading.expected,
        tags: scenario.tags,
        state: evalReviewState(reading),
        node: node.id,
        hue: node.hue,
        filterKind: EVAL_FILTER_KIND.RESULT,
      })
    }
  }
  blind.sort((a, b) => String(a.node).localeCompare(String(b.node)) || String(a.scenario).localeCompare(String(b.scenario)))
  return [...blind, ...items.sort(byNewest)]
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
          tags: scenario.tags,
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
        tags: scenario.tags,
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

const evalItemKey = (item: any): string => `${String(item?.node ?? '')}\0${String(item?.scenario ?? '')}`

function evalNeighbor(item: any): EvalNeighbor {
  return {
    node: String(item.node),
    scenario: String(item.scenario),
    state: String(item.state ?? evalReviewState(item)),
  }
}

export function boundedEvalNeighbors(items: ReviewItem[], node: string, scenario: string, want = 5) {
  const key = `${node}\0${scenario}`
  const index = items.findIndex((item) => evalItemKey(item) === key)
  if (index < 0) return { prev: [], next: [], total: items.length, index: null, order: 'default' as const }
  const before = index
  const after = items.length - index - 1
  const take = Math.min(want, before + after)
  const nextN = Math.min(after, Math.max(Math.ceil(take / 2), take - before))
  const prevN = Math.min(before, take - nextN)
  return {
    prev: items.slice(index - prevN, index).reverse().map(evalNeighbor),
    next: items.slice(index + 1, index + 1 + nextN).map(evalNeighbor),
    total: items.length,
    index,
    order: 'default' as const,
  }
}

export function projectEvalDetail(
  items: ReviewItem[],
  historySource: ReviewItem[],
  node: string,
  scenario: string,
  metadata: { scope?: string | null; summary?: SessionEvals['summary']; evalRevision?: SessionEvals['evalRevision'] } = {},
): EvalDetailReview {
  const results = items.filter((item: any) => item.filterKind === EVAL_FILTER_KIND.RESULT)
  const selected = results.find((item) => evalItemKey(item) === `${node}\0${scenario}`) ?? null
  const history = historySource.filter((reading: any) => String(reading.scenario) === scenario)
  const neighbors = boundedEvalNeighbors(results, node, scenario)
  const scope = metadata.scope ?? null
  return {
    scope,
    selected,
    history,
    neighbors,
    revision: revisionOf({ scope, selected, history, neighbors, summary: metadata.summary, evalRevision: metadata.evalRevision }),
    ...(metadata.summary ? { summary: metadata.summary } : {}),
    ...(metadata.evalRevision ? { evalRevision: metadata.evalRevision } : {}),
  }
}

export async function evalDetailReview(node: string, scenario: string, scope?: string | null): Promise<EvalDetailReview | null> {
  if (scope) {
    const model = await buildSessionEvals(scope)
    if (!model) return null
    const sourceNode = model.nodes.find((candidate) => candidate.id === node)
    return projectEvalDetail(scopedEvalReviewItems(model), sourceNode?.evals ?? [], node, scenario, {
      scope,
      summary: model.summary,
      evalRevision: model.evalRevision,
    })
  }
  await getBoard()
  const snapshot = readReviewSnapshot()
  const sourceNode = snapshot.evalNodes.find((candidate) => candidate.id === node)
  return projectEvalDetail(trunkEvalReviewItems(snapshot.evalNodes), sourceNode?.readings ?? [], node, scenario)
}

async function timelineEvalReview(text: string, requestedPage: unknown) {
  const node = readToken(text, 'node')
  if (!node) return null
  const [timeline, sessions] = await Promise.all([evalTimeline(node), listSessions()])
  const measured = new Set(timeline.readings.map((reading) => reading.scenario))
  const items = [
    ...timeline.scenarios.filter((scenario) => !measured.has(scenario.name)).map((scenario) => ({
      ...scenario,
      scenario: scenario.name,
      node,
      filterKind: EVAL_FILTER_KIND.UNMEASURED,
    })),
    ...timeline.readings.map((reading, index) => ({
      ...reading,
      state: evalReviewState(reading),
      node,
      filterKind: EVAL_FILTER_KIND.RESULT,
      filterKey: `${EVAL_FILTER_KIND.RESULT}:${index}`,
    })),
    ...(timeline.dangling ?? []).map((track) => ({
      ...track,
      node,
      filterKind: EVAL_FILTER_KIND.DANGLING,
      filterKey: `${EVAL_FILTER_KIND.DANGLING}:${track.threadId}`,
    })),
  ]
  const filtered = evalFilterModel(items, tokenFilterState(text, 'eval'), { sessions, defaultKind: 'all', defaultSection: '' })
  return {
    scope: null,
    view: 'timeline',
    node,
    hasEvalFile: timeline.hasEvalFile,
    gates: [],
    unknown: 0,
    ...paginateReview(items, filtered.shown, filtered, requestedPage, {
      domain: 'evals', view: 'timeline', node, timeline, sessions: sessions.map((session) => session.id),
    }),
  }
}

export async function evalsReview(query: string | undefined, requestedPage: unknown, options: { view?: string } = {}) {
  const text = String(query ?? '').trim() || EVAL_QUERY_DEFAULT
  if (options.view === 'timeline') return timelineEvalReview(text, requestedPage)
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
      summary: model.summary,
      evalRevision: model.evalRevision,
      ...paginateReview(items, filtered.shown, filtered, requestedPage, {
        domain: 'evals', scope, items, gates: model.gates, summary: model.summary,
        evalRevision: model.evalRevision, sessions: sessions.map((session) => session.id),
      }),
    }
  }
  const board = await getBoard()
  const items = trunkEvalReviewItems(readReviewSnapshot().evalNodes)
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
