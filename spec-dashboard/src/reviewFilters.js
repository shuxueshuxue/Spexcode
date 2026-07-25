import { sessionHeadline, sessionPresent } from './session.js'
import { effectiveTokens, tokenize } from './reviewQuery.js'

// [[review-filters]]: one pure filter engine — the single home of Issues/Evals FIELD SEMANTICS. Domain
// adapters below provide field values; surfaces provide only the state home and presentation: the
// canonical pages parse their ONE visible token text ([[review-query]]) and bridge it here, the Spec
// Information panes keep plain local state. Neither duplicates matching.

const text = (value) => String(value ?? '').trim().toLocaleLowerCase()
const values = (value) => (Array.isArray(value) ? value : value == null || value === '' ? [] : [value])
const unique = (items) => [...new Set(items.flatMap(values).filter((value) => value != null && value !== '').map(String))]

export const EVAL_FILTER_KIND = Object.freeze({
  RESULT: 'result',
  BLIND: 'blind',
  UNMEASURED: 'unmeasured',
  DANGLING: 'dangling',
})

export const evidenceList = (reading) =>
  reading?.evidence?.length ? reading.evidence
  : reading?.blob != null ? [{ hash: reading.blob, kind: reading.blobKind || 'image', state: reading.blobState || 'present' }]
  : []

export const kindsOf = (reading) => {
  const evidence = evidenceList(reading)
  if (!evidence.length) return ['note']
  return ['video', 'image', 'transcript', 'data'].filter((kind) => evidence.some((item) => item.kind === kind))
}

const optionLabel = (t, key, fallback) => t ? t(key) : fallback
const allOption = (t) => ({ value: '', label: optionLabel(t, 'reviewList.all', 'All') })
const optionsFor = (items, facet, state, context, t) => {
  const active = state[facet.key] != null && String(state[facet.key]) !== ''
  // a fixed-value ENUM facet keeps its ACTIVE value as a real (checked) row even when no data carries
  // it — an active facet must never hide its own off-switch; data-valued facets stay data-derived.
  const found = facet.fixedValues
    ? facet.fixedValues.filter((value) => facet.enumerateFixed
      || (active && String(state[facet.key]) === String(value))
      || items.some((item) => values(facet.values(item, context)).map(String).includes(String(value))))
    : unique(items.map((item) => facet.values(item, context)))
  const available = facet.available
    ? facet.available(found, items, state, context)
    : found.length >= (facet.minValues ?? 2)
  if (!available && !active) return []
  return [allOption(t), ...found.map((value) => ({
    value,
    label: facet.labelValue ? facet.labelValue(value, context) : value,
  }))]
}

// A SPLIT section reports its count as two named buckets instead of one number. The predicate is BINARY
// and applied to the section's own matched rows, so the buckets always re-add to that section's whole
// population — a surface can lead with one half without the count quietly shrinking. The adapter alone
// decides which sections split and on what axis; the engine invents no bucket.
const splitCount = (matched, split, context) => {
  const first = matched.filter((item) => split.is(item, context)).length
  return { [split.keys[0]]: first, [split.keys[1]]: matched.length - first }
}

// the one reading rule for a section count, whichever shape the adapter declared.
export const sectionTotal = (count) => (typeof count === 'number'
  ? count
  : Object.values(count ?? {}).reduce((sum, value) => sum + value, 0))

export function filterReviewItems(items, state, config, context = {}) {
  // `q` is one substring or an ARRAY of substrings (the token text's bare words/phrases), conjunctive;
  // an `impossible` state (an unknown qualifier in the canonical text) honestly matches NOTHING.
  const qs = values(state.q).map(text).filter(Boolean)
  const faceted = state.impossible ? [] : items.filter((item) => (
    qs.every((q) => config.search(item, context).some((value) => text(value).includes(q)))
    && config.facets.every((facet) => {
      const selected = state[facet.key]
      return selected == null || selected === ''
        || (facet.matches
          ? facet.matches(item, selected, context)
          : values(facet.values(item, context)).map(String).includes(String(selected)))
    })
  ))
  const sectionValue = config.section && state[config.section.key]
  const sectionMatch = (item, selected) => (config.section.matches
    ? config.section.matches(item, selected, context)
    : String(config.section.value(item, context)) === String(selected))
  const shown = sectionValue == null || sectionValue === ''
    ? faceted
    : faceted.filter((item) => sectionMatch(item, sectionValue))
  const sections = config.section
    ? Object.fromEntries(config.section.options.map((option) => {
      const matched = faceted.filter((item) => sectionMatch(item, option.value))
      return [option.value, option.split && config.section.split
        ? splitCount(matched, config.section.split, context)
        : matched.length]
    }))
    : {}
  const facets = Object.fromEntries(config.facets.map((facet) => [facet.key, {
    key: facet.key,
    label: optionLabel(context.t, facet.label, facet.key),
    value: state[facet.key] || '',
    options: optionsFor(items, facet, state, context, context.t),
  }]))
  return { state, faceted, shown, sections, facets }
}

export const reviewActorName = (actor) => String(actor || '').length > 22 ? `${String(actor).slice(0, 8)}…` : actor
// the source-session PRESENCE join ([[live-session-filter]]): originator or any reply author still
// resolves on the board — membership, never liveness.
const issuePresent = (issue, sessions) => !!sessionPresent(sessions, issue.by)
  || (Array.isArray(issue.replies) && issue.replies.some((reply) => sessionPresent(sessions, reply.by)))
const presenceFacet = (valuesOf) => ({
  key: 'session', label: 'reviewList.facetSession', fixedValues: ['present', 'missing'],
  values: valuesOf,
  labelValue: (value, { t }) => optionLabel(t, value === 'present' ? 'reviewList.sessionPresent' : 'reviewList.sessionMissing', value),
})

export function issueFilterState(raw = {}, { defaultSection = '' } = {}) {
  const state = raw.state === 'closed' || raw.concluded === '1'
    ? 'closed'
    : raw.state || defaultSection
  return {
    q: raw.q || '', state, impossible: raw.impossible === true,
    author: raw.author || '', store: raw.store || '', node: raw.node || '',
    session: raw.session || '',
  }
}

const ISSUE_CONFIG = {
  search: (issue) => [issue.id, issue.concern, issue.by, ...(issue.nodes || [])],
  section: {
    key: 'state',
    value: (issue) => issue.status === 'open' ? 'open' : 'closed',
    // open|closed are the lifecycle halves; a concrete concluded spelling (landed) matches that status
    // honestly instead of pretending the enum is binary.
    matches: (issue, selected) => (selected === 'open' ? issue.status === 'open'
      : selected === 'closed' ? issue.status !== 'open' : issue.status === selected),
    options: [{ value: 'open', label: 'reviewList.open' }, { value: 'closed', label: 'reviewList.closed' }],
  },
  facets: [
    { key: 'author', label: 'reviewList.facetAuthor', values: (issue) => issue.by, labelValue: reviewActorName },
    { key: 'store', label: 'reviewList.facetStore', values: (issue) => issue.store },
    { key: 'node', label: 'reviewList.facetNode', values: (issue) => issue.nodes || [] },
    presenceFacet((issue, { sessions }) => issuePresent(issue, sessions) ? 'present' : 'missing'),
  ],
}

export function issueFilterModel(items, raw = {}, context = {}) {
  const state = issueFilterState(raw, { defaultSection: context.defaultSection ?? '' })
  const model = filterReviewItems(items, state, ISSUE_CONFIG, context)
  model.section = {
    key: 'state', label: optionLabel(context.t, 'reviewList.facetState', 'State'), value: state.state,
    meaningful: Object.values(model.sections).filter((count) => sectionTotal(count) > 0).length > 1 || !!state.state,
    options: [allOption(context.t), ...ISSUE_CONFIG.section.options.map((option) => ({
      value: option.value,
      label: optionLabel(context.t, option.label, option.value),
      count: sectionTotal(model.sections[option.value]),
    }))].filter((option, index, all) => index === 0 || option.count > 0 || option.value === state.state),
  }
  return model
}

const evalIsResult = (entry) => entry.filterKind === EVAL_FILTER_KIND.RESULT
const verdictOf = (entry) => evalIsResult(entry)
  ? (entry.verdict?.status || 'unscored')
  : entry.filterKind === EVAL_FILTER_KIND.BLIND || entry.filterKind === EVAL_FILTER_KIND.UNMEASURED
    ? 'unmeasured'
    : 'unscored'
const reviewStateOf = (entry) => (evalIsResult(entry) && entry.fresh && entry.humanOk ? 'reviewed' : 'current')
// the ONE freshness axis of the Eval adapter — the facet's option values and the verdict sections' split
// read it, so a chip and its Freshness menu can never disagree about what "stale" counts.
const evalFresh = (entry) => entry.fresh === true
const freshnessOf = (entry) => (evalIsResult(entry) ? (evalFresh(entry) ? 'fresh' : 'stale') : null)
export const evalReviewState = (reading) => {
  const status = reading?.verdict?.status
  if (status !== 'pass' && status !== 'fail') return 'empty'
  if (reading.fresh) return status
  return status === 'pass' ? 'stalePass' : 'staleFail'
}
const shortSession = (value, sessions) => {
  const session = sessions.find((item) => item.id === value)
  if (session) return sessionHeadline(session)
  return String(value || '').length > 22 ? `${String(value).slice(0, 8)}…` : value
}

export function evalFilterState(raw = {}, { defaultKind = 'all', defaultSection = '' } = {}) {
  const legacyReview = raw.ok === '1' ? 'reviewed' : raw.ok
  return {
    q: raw.q || '', kind: raw.kind || defaultKind, impossible: raw.impossible === true,
    verdict: raw.verdict || '', freshness: raw.freshness || '', node: raw.node || '', filer: raw.filer || '',
    session: raw.session || '', review: raw.review || legacyReview || defaultSection,
  }
}

const EVAL_CONFIG = {
  search: (entry) => [entry.scenario, entry.node, entry.by, entry.evaluator],
  section: {
    key: 'verdict', value: verdictOf,
    // A MEASURED verdict carries a reading, so it also carries freshness: its count splits into the fresh
    // half and the stale half that still owes a re-measurement. The two halves re-add to the verdict's
    // whole population — splitting reports the remeasurement debt, it never hides a row. `unmeasured` owns
    // no reading and therefore no freshness axis, so it stays one honest number.
    split: { keys: ['fresh', 'stale'], is: evalFresh },
    options: [
      { value: 'fail', label: 'reviewList.verdict.fail', split: true },
      { value: 'pass', label: 'reviewList.verdict.pass', split: true },
      { value: 'unmeasured', label: 'reviewList.verdict.unmeasured' },
    ],
  },
  facets: [
    {
      key: 'review', label: 'reviewList.facetReview', fixedValues: ['current', 'reviewed'], enumerateFixed: true,
      values: reviewStateOf,
      labelValue: (value, { t }) => optionLabel(t, value === 'reviewed' ? 'reviewList.reviewed' : 'reviewList.needsReview', value),
    },
    {
      key: 'freshness', label: 'reviewList.facetFreshness', minValues: 2,
      values: (entry) => freshnessOf(entry) ?? [],
      labelValue: (value, { t }) => optionLabel(t, `reviewList.freshness.${value}`, value),
    },
    {
      key: 'kind', label: 'reviewList.facetKind', fixedValues: ['video', 'image'], minValues: 1,
      values: (entry) => evalIsResult(entry) ? kindsOf(entry).filter((kind) => kind === 'video' || kind === 'image') : [],
      matches: (entry, selected) => selected === 'all' || (evalIsResult(entry) && kindsOf(entry).includes(selected)),
      labelValue: (value, { t }) => optionLabel(t, `evalsFeed.kind.${value}`, value),
      available: (found, _items, state) => found.length > 0 || state.kind !== 'all',
    },
    { key: 'node', label: 'reviewList.facetNode', values: (entry) => entry.node },
    {
      key: 'filer', label: 'reviewList.facetFiler', values: (entry) => evalIsResult(entry) ? entry.by : [],
      labelValue: (value, { sessions = [] }) => shortSession(value, sessions),
    },
    presenceFacet((entry, { sessions }) => (evalIsResult(entry)
      ? (sessionPresent(sessions, entry.by) ? 'present' : 'missing')
      : [])),
  ],
}

export function evalFilterModel(items, raw = {}, context = {}) {
  const state = evalFilterState(raw, {
    defaultKind: context.defaultKind ?? 'all',
    defaultSection: context.defaultSection ?? '',
  })
  const model = filterReviewItems(items, state, EVAL_CONFIG, context)
  model.section = {
    key: 'verdict', label: optionLabel(context.t, 'reviewList.facetVerdict', 'Verdict'), value: state.verdict,
    meaningful: Object.values(model.sections).some((count) => sectionTotal(count) > 0) || !!state.verdict,
    // the menu/popup face of the same sections keeps the verdict's WHOLE count: a compact radio row has no
    // room for the split, and it must still agree with the list it filters.
    options: [allOption(context.t), ...EVAL_CONFIG.section.options.map((option) => ({
      value: option.value,
      label: optionLabel(context.t, option.label, option.value),
      count: sectionTotal(model.sections[option.value]),
    }))].filter((option, index) => index === 0 || option.count > 0 || option.value === state.verdict),
  }
  const kindFacet = model.facets.kind
  if (kindFacet.options.length) {
    kindFacet.options = [
      { value: 'all', label: optionLabel(context.t, 'evalsFeed.kind.all', 'All') },
      ...kindFacet.options.filter((option) => option.value !== '').map((option) => ({ ...option })),
    ]
    kindFacet.value = state.kind
  }
  return model
}

export function filterMenuGroups(model, onChange, keys) {
  return keys.map((key) => key === 'section' ? model.section : model.facets[key]).filter((facet) => (
    facet?.meaningful !== false
    && (facet?.options?.length > 1 || (facet?.value != null && facet.value !== '' && facet.value !== 'all'))
  )).map((facet) => ({
    key: facet.key,
    label: facet.label,
    value: facet.value,
    active: facet.value != null && facet.value !== '' && facet.value !== 'all',
    options: facet.options,
    clearLabel: facet.value === 'all' ? null : undefined,
    onChange: (value) => onChange({ [facet.key]: value || null }),
  }))
}

// the CANONICAL pages' bridge ([[review-query]] → this engine): parse the ONE visible token text into
// engine state. Bare words/phrases become conjunctive q substrings; duplicate qualifiers are last-wins;
// a qualifier outside the page's map (or a wrong is: identity) marks the state IMPOSSIBLE — the token
// stays verbatim in the text and the list honestly shows nothing. `scope:` maps to no filter: it picks
// the DATA SOURCE upstream ([[evals-view]]), never a per-row predicate.
const TOKEN_MAPS = {
  issue: {
    is: (v) => (v === 'issue' ? {} : null),
    state: (v) => ({ state: v }),
    store: (v) => ({ store: v }),
    author: (v) => ({ author: v }),
    node: (v) => ({ node: v }),
    session: (v) => ({ session: v }),
  },
  eval: {
    is: (v) => (v === 'eval' ? {} : null),
    state: (v) => ({ review: v }),
    verdict: (v) => ({ verdict: v }),
    freshness: (v) => ({ freshness: v }),
    evidence: (v) => ({ kind: v }),
    node: (v) => ({ node: v }),
    filer: (v) => ({ filer: v }),
    session: (v) => ({ session: v }),
    scope: () => ({}),
  },
}

export function tokenFilterState(text, domain) {
  const map = TOKEN_MAPS[domain]
  const state = { q: [] }
  for (const token of effectiveTokens(tokenize(text))) {
    if (token.key == null) { state.q.push(token.value); continue }
    const toState = map[token.key]
    const mapped = toState ? toState(token.value) : null
    if (mapped == null) return { impossible: true, q: [] }
    Object.assign(state, mapped)
  }
  return state
}
