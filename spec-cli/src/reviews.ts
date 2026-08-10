import { createHash } from 'node:crypto'
import { listSessions } from './sessions.js'
import { getBoard, getBoardForForgeRevision } from './graphCache.js'
import { type SessionEvalOrderRow, buildSessionEvals, type SessionEvals } from '../../spec-eval/src/sessioneval.js'
import { evalTimeline } from '../../spec-eval/src/evaltab.js'
import { issuesEnabled as issuesEnabledForReview } from './localIssues.js'
import { issueStores as issueStoresForReview } from './issues.js'
import { hasReviewSnapshot, readReviewSnapshot } from '@spexcode/spec-core'
import { residentForgeRevision, residentForgeState } from '../../spec-forge/src/resident.js'
// @ts-expect-error The browser-safe domain module is deliberately plain JS so the browser and server execute
// the exact same tokenizer/matcher through the one public review entry.
import { EVAL_FILTER_KIND, evalFilterModel, evalReviewState, issueFilterModel, tokenFilterState } from '@spexcode/spec-core/review'
// @ts-expect-error See the shared-domain note above.
import { EVAL_QUERY_DEFAULT, ISSUE_QUERY_DEFAULT, readToken } from '@spexcode/spec-core/review'

export const REVIEW_PER_PAGE = 25

type ReviewItem = Record<string, unknown>
// A section count is one number, or — when the domain adapter splits that section — its named buckets,
// which re-add to the same whole population ([[review-filters]] owns the split; Evals splits its measured
// verdicts into {fresh,stale} so the remeasurement debt travels with the count instead of being recomputed
// per surface). The fold happens ONCE, here on the server, over the complete filtered population.
export type ReviewCount = number | Record<string, number>
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
  counts: Record<string, ReviewCount>
  facets: Record<string, ReviewFacet>
  section: { key: string; value: string; options: ReviewOption[] } | null
}

export type EvalDetailReview = {
  scope: string | null
  requestedScope: string | null
  scopeFallback: 'trunk' | null
  availability: 'measured' | 'unmeasured' | 'missing'
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

type EvalDetailMetadata = {
  scope?: string | null
  requestedScope?: string | null
  scopeFallback?: 'trunk' | null
  summary?: SessionEvals['summary']
  evalRevision?: SessionEvals['evalRevision']
  // the scope's whole measured sequence, when `items` deliberately holds only the rendered window
  sequence?: { node: string; scenario: string }[]
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
  residentForgeState()
  if (!hasReviewSnapshot()) await getBoard()
  else if (readReviewSnapshot().forgeRevision < residentForgeRevision()) {
    await getBoardForForgeRevision(residentForgeRevision())
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

const byNewest = (a: any, b: any): number => Number(b.filterKind === EVAL_FILTER_KIND.RESULT) - Number(a.filterKind === EVAL_FILTER_KIND.RESULT)
  || String(b.ts ?? '').localeCompare(String(a.ts ?? ''))
  || String(a.node ?? '').localeCompare(String(b.node ?? ''))
  || String(a.scenario ?? '').localeCompare(String(b.scenario ?? ''))

export function trunkEvalReviewItems(nodes: any[]): ReviewItem[] {
  const items: any[] = []
  for (const node of nodes ?? []) {
    const latest = new Map<string, any>()
    for (const reading of node.evals ?? []) if (!latest.has(reading.scenario)) latest.set(reading.scenario, reading)
    for (const scenario of node.scenarios ?? []) {
      const reading = latest.get(scenario.name)
      if (!reading) {
        items.push({
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
  return items.sort(byNewest)
}

export function scopedEvalReviewItems(model: SessionEvals): ReviewItem[] {
  const items: any[] = []
  for (const node of model.nodes ?? []) {
    const latest = new Map<string, any>()
    for (const reading of node.evals ?? []) if (!latest.has(reading.scenario)) latest.set(reading.scenario, reading)
    for (const scenario of node.scenarios ?? []) {
      const reading = latest.get(scenario.name)
      if (!reading) {
        items.push({
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
        impact: scenario.impact,
        state: evalReviewState(reading),
        node: node.id,
        hue: node.hue,
        filterKind: EVAL_FILTER_KIND.RESULT,
      }
      items.push(item)
    }
  }
  return items.sort(byNewest)
}

const evalItemKey = (item: any): string => `${String(item?.node ?? '')}\0${String(item?.scenario ?? '')}`

function evalNeighbor(item: any, stateOf: (row: { node: string; scenario: string }) => string): EvalNeighbor {
  return {
    node: String(item.node),
    scenario: String(item.scenario),
    state: stateOf(item),
  }
}

// `sequence` is the whole measured population in list order; `stateOf` answers only for rows whose freshness
// was actually computed. On a focused build those are two different sets — the sequence spans the scope, the
// states cover the selected row and its window — which is exactly why the state is looked up rather than
// carried: a row this response does not render contributes its POSITION and nothing else.
export function boundedEvalNeighbors(
  sequence: { node: string; scenario: string }[],
  node: string,
  scenario: string,
  stateOf: (row: { node: string; scenario: string }) => string,
  want = 5,
) {
  const items = sequence
  const key = `${node}\0${scenario}`
  const index = items.findIndex((item) => evalItemKey(item) === key)
  if (index < 0) return { prev: [], next: [], total: items.length, index: null, order: 'default' as const }
  const before = index
  const after = items.length - index - 1
  const take = Math.min(want, before + after)
  const nextN = Math.min(after, Math.max(Math.ceil(take / 2), take - before))
  const prevN = Math.min(before, take - nextN)
  return {
    prev: items.slice(index - prevN, index).reverse().map((item) => evalNeighbor(item, stateOf)),
    next: items.slice(index + 1, index + 1 + nextN).map((item) => evalNeighbor(item, stateOf)),
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
  metadata: EvalDetailMetadata = {},
): EvalDetailReview {
  const results = items.filter((item: any) => item.filterKind === EVAL_FILTER_KIND.RESULT)
  const selected = results.find((item) => evalItemKey(item) === `${node}\0${scenario}`) ?? null
  const availability = selected
    ? 'measured'
    : items.some((item: any) => evalItemKey(item) === `${node}\0${scenario}` && item.filterKind === EVAL_FILTER_KIND.BLIND)
      ? 'unmeasured'
      : 'missing'
  const history = historySource.filter((reading: any) => String(reading.scenario) === scenario)
  const stateByKey = new Map(results.map((item: any) => [evalItemKey(item), String(item.state ?? evalReviewState(item))]))
  const sequence = metadata.sequence
    ?? results.map((item: any) => ({ node: String(item.node), scenario: String(item.scenario) }))
  const neighbors = boundedEvalNeighbors(sequence, node, scenario,
    (row) => stateByKey.get(evalItemKey(row)) ?? 'empty')
  const scope = metadata.scope ?? null
  const requestedScope = metadata.requestedScope ?? scope
  const scopeFallback = metadata.scopeFallback ?? null
  return {
    scope,
    requestedScope,
    scopeFallback,
    availability,
    selected,
    history,
    neighbors,
    revision: revisionOf({ scope, requestedScope, scopeFallback, availability, selected, history, neighbors, summary: metadata.summary, evalRevision: metadata.evalRevision }),
    ...(metadata.summary ? { summary: metadata.summary } : {}),
    ...(metadata.evalRevision ? { evalRevision: metadata.evalRevision } : {}),
  }
}

// the measured population in list order, from the freshness-free rows: a filed reading leads (newest first),
// and the tie-breaks are the identity ones — the SAME comparison `byNewest` applies, over the only fields it
// actually reads. Blind rows never enter, exactly as the detail's own `results` filter excludes them.
export function measuredSequence(order: SessionEvalOrderRow[]): { node: string; scenario: string }[] {
  return order.filter((row) => row.ts)
    .sort((a, b) => String(b.ts ?? '').localeCompare(String(a.ts ?? ''))
      || a.node.localeCompare(b.node) || a.scenario.localeCompare(b.scenario))
    .map((row) => ({ node: row.node, scenario: row.scenario }))
}

// the nodes whose verdicts the response will publish: the selected row's, plus a window wide enough to
// contain any neighbour boundedEvalNeighbors can choose (it takes at most five, split around the index).
export function focusNodes(order: SessionEvalOrderRow[], node: string, scenario: string): string[] {
  const sequence = measuredSequence(order)
  const index = sequence.findIndex((row) => row.node === node && row.scenario === scenario)
  if (index < 0) return [node]
  return [...new Set([node, ...sequence.slice(Math.max(0, index - 6), index + 7).map((row) => row.node)])]
}

async function trunkEvalDetailReview(node: string, scenario: string, metadata: EvalDetailMetadata = {}): Promise<EvalDetailReview> {
  await getBoard()
  const snapshot = readReviewSnapshot()
  const sourceNode = snapshot.evalNodes.find((candidate) => candidate.id === node)
  return projectEvalDetail(trunkEvalReviewItems(snapshot.evalNodes), sourceNode?.readings ?? [], node, scenario, metadata)
}

export async function evalDetailReview(node: string, scenario: string, scope?: string | null): Promise<EvalDetailReview> {
  if (scope) {
    // A detail renders ONE row plus at most five neighbours, but owes the whole population's index/total.
    // So name the window from the freshness-free sequence and let only those nodes pay the freshness pass;
    // a build that finds a full cached model ignores the pick and answers from it instead.
    const model = await buildSessionEvals(scope, (order) => focusNodes(order, node, scenario))
    if (!model) return trunkEvalDetailReview(node, scenario, { requestedScope: scope, scopeFallback: 'trunk' })
    const sourceNode = model.nodes.find((candidate) => candidate.id === node)
    return projectEvalDetail(scopedEvalReviewItems(model), sourceNode?.evals ?? [], node, scenario, {
      scope,
      requestedScope: scope,
      summary: model.summary,
      evalRevision: model.evalRevision,
      ...(model.order ? { sequence: measuredSequence(model.order) } : {}),
    })
  }
  return trunkEvalDetailReview(node, scenario)
}

export function timelineEvalReviewItems(timeline: Awaited<ReturnType<typeof evalTimeline>>, node: string): ReviewItem[] {
  const declared = new Set(timeline.scenarios.map((scenario) => scenario.name))
  const latest = new Map<string, any>()
  for (const reading of timeline.readings) {
    if (declared.has(reading.scenario) && !latest.has(reading.scenario)) latest.set(reading.scenario, reading)
  }
  return [
    ...timeline.scenarios.filter((scenario) => !latest.has(scenario.name)).map((scenario) => ({
      ...scenario,
      scenario: scenario.name,
      node,
      filterKind: EVAL_FILTER_KIND.UNMEASURED,
    })),
    ...[...latest.values()].map((reading) => ({
      ...reading,
      state: evalReviewState(reading),
      node,
      filterKind: EVAL_FILTER_KIND.RESULT,
      filterKey: `${EVAL_FILTER_KIND.RESULT}:${reading.scenario}`,
    })),
    ...(timeline.dangling ?? []).map((track) => ({
      ...track,
      node,
      filterKind: EVAL_FILTER_KIND.DANGLING,
      filterKey: `${EVAL_FILTER_KIND.DANGLING}:${track.threadId}`,
    })),
  ]
}

async function timelineEvalReview(text: string, requestedPage: unknown) {
  const node = readToken(text, 'node')
  if (!node) return null
  const [timeline, sessions] = await Promise.all([evalTimeline(node), listSessions()])
  const items = timelineEvalReviewItems(timeline, node)
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
      gates: [],
      unknown: model.nodes.reduce((count, node) => count + (node.unknownCoverage?.length ?? 0), 0),
      summary: model.summary,
      evalRevision: model.evalRevision,
      ...paginateReview(items, filtered.shown, filtered, requestedPage, {
        domain: 'evals', scope, query: text, gates: [], summary: model.summary,
        evalRevision: model.evalRevision, sessions: sessions.map((session) => session.id),
      }),
    }
  }
  if (!hasReviewSnapshot()) await getBoard()
  const sessions = await listSessions()
  const items = trunkEvalReviewItems(readReviewSnapshot().evalNodes)
  const filtered = evalFilterModel(items, tokenFilterState(text, 'eval'), { sessions, defaultKind: 'all', defaultSection: '' })
  return {
    scope: null,
    gates: [],
    unknown: 0,
    ...paginateReview(items, filtered.shown, filtered, requestedPage, {
      domain: 'evals', items, sessions: sessions.map((session) => session.id),
    }),
  }
}
