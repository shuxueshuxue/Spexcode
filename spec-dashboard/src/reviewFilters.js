import { liveSession, sessionHeadline } from './session.js'

// [[review-filters]]: one pure filter engine. Domain adapters below provide field values; surfaces provide
// only the state home (canonical hash query or Spec Information local state) and presentation.

const text = (value) => String(value ?? '').trim().toLocaleLowerCase()
const values = (value) => (Array.isArray(value) ? value : value == null || value === '' ? [] : [value])
const unique = (items) => [...new Set(items.flatMap(values).filter((value) => value != null && value !== '').map(String))]

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
  const found = facet.fixedValues
    ? facet.fixedValues.filter((value) => items.some((item) => values(facet.values(item, context)).map(String).includes(String(value))))
    : unique(items.map((item) => facet.values(item, context)))
  const active = state[facet.key] != null && String(state[facet.key]) !== ''
  const available = facet.available
    ? facet.available(found, items, state, context)
    : found.length >= (facet.minValues ?? 2)
  if (!available && !active) return []
  return [allOption(t), ...found.map((value) => ({
    value,
    label: facet.labelValue ? facet.labelValue(value, context) : value,
  }))]
}

export function filterReviewItems(items, state, config, context = {}) {
  const q = text(state.q)
  const faceted = items.filter((item) => (
    (!q || config.search(item, context).some((value) => text(value).includes(q)))
    && config.facets.every((facet) => {
      const selected = state[facet.key]
      return selected == null || selected === ''
        || (facet.matches
          ? facet.matches(item, selected, context)
          : values(facet.values(item, context)).map(String).includes(String(selected)))
    })
  ))
  const sectionValue = config.section && state[config.section.key]
  const shown = sectionValue == null || sectionValue === ''
    ? faceted
    : faceted.filter((item) => String(config.section.value(item, context)) === String(sectionValue))
  const sections = config.section
    ? Object.fromEntries(config.section.options.map((option) => [option.value, faceted.filter((item) => String(config.section.value(item, context)) === String(option.value)).length]))
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
const issueIsLive = (issue, sessions) => !!liveSession(sessions, issue.by)
  || (Array.isArray(issue.replies) && issue.replies.some((reply) => liveSession(sessions, reply.by)))

export function issueFilterState(raw = {}, { defaultSection = '' } = {}) {
  const state = raw.state === 'closed' || raw.concluded === '1'
    ? 'closed'
    : raw.state === 'open' ? 'open' : defaultSection
  return {
    q: raw.q || '', state,
    author: raw.author || '', store: raw.store || '', node: raw.node || '',
    live: raw.live === '1' ? '1' : '',
  }
}

const ISSUE_CONFIG = {
  search: (issue) => [issue.id, issue.concern, issue.by, ...(issue.nodes || [])],
  section: {
    key: 'state',
    value: (issue) => issue.status === 'open' ? 'open' : 'closed',
    options: [{ value: 'open', label: 'reviewList.open' }, { value: 'closed', label: 'reviewList.closed' }],
  },
  facets: [
    { key: 'author', label: 'reviewList.facetAuthor', values: (issue) => issue.by, labelValue: reviewActorName },
    { key: 'store', label: 'reviewList.facetStore', values: (issue) => issue.store },
    { key: 'node', label: 'reviewList.facetNode', values: (issue) => issue.nodes || [] },
    {
      key: 'live', label: 'reviewList.facetLive', values: (issue, { sessions }) => issueIsLive(issue, sessions) ? '1' : [],
      minValues: 1, available: (_found, items, state, { sessions }) => state.live === '1' || items.some((item) => issueIsLive(item, sessions)),
      labelValue: (_value, { t }) => optionLabel(t, 'reviewList.live', 'Live session'),
    },
  ],
}

export function issueFilterModel(items, raw = {}, context = {}) {
  const state = issueFilterState(raw, { defaultSection: context.defaultSection ?? '' })
  const model = filterReviewItems(items, state, ISSUE_CONFIG, context)
  model.section = {
    key: 'state', label: optionLabel(context.t, 'reviewList.facetState', 'State'), value: state.state,
    meaningful: Object.values(model.sections).filter((count) => count > 0).length > 1 || !!state.state,
    options: [allOption(context.t), ...ISSUE_CONFIG.section.options.map((option) => ({
      value: option.value,
      label: optionLabel(context.t, option.label, option.value),
      count: model.sections[option.value] || 0,
    }))].filter((option, index, all) => index === 0 || option.count > 0 || option.value === state.state),
  }
  return model
}

const evalIsReading = (entry) => entry.reading !== false
const evalIsLive = (entry, sessions) => evalIsReading(entry) && !!liveSession(sessions, entry.by)
const verdictOf = (entry) => evalIsReading(entry) ? (entry.verdict?.status || 'unscored') : 'unscored'
const reviewed = (entry) => evalIsReading(entry) && !!(entry.fresh && entry.humanOk)
const shortSession = (value, sessions) => {
  const session = sessions.find((item) => item.id === value)
  if (session) return sessionHeadline(session)
  return String(value || '').length > 22 ? `${String(value).slice(0, 8)}…` : value
}

export const defaultEvalKind = (items) => items.some((entry) => evalIsReading(entry) && kindsOf(entry).includes('video'))
  ? 'video'
  : items.some((entry) => evalIsReading(entry) && kindsOf(entry).includes('image')) ? 'image' : 'all'

export function evalFilterState(raw = {}, { defaultKind = 'all', defaultSection = '' } = {}) {
  const kind = ['video', 'image', 'all'].includes(raw.kind) ? raw.kind : defaultKind
  return {
    q: raw.q || '', kind,
    verdict: raw.verdict || '', freshness: raw.freshness || '', node: raw.node || '', filer: raw.filer || '',
    live: raw.live === '1' ? '1' : '', ok: raw.ok === '1' ? '1' : raw.ok === 'current' ? 'current' : defaultSection,
  }
}

const EVAL_CONFIG = {
  search: (entry) => [entry.scenario, entry.node, entry.by, entry.evaluator],
  section: {
    key: 'ok', value: (entry) => reviewed(entry) ? '1' : 'current',
    options: [{ value: 'current', label: 'reviewList.current' }, { value: '1', label: 'reviewList.reviewed' }],
  },
  facets: [
    { key: 'verdict', label: 'reviewList.facetVerdict', values: verdictOf, labelValue: (value, { t }) => optionLabel(t, `reviewList.verdict.${value}`, value) },
    {
      key: 'freshness', label: 'reviewList.facetFreshness', minValues: 2,
      values: (entry) => evalIsReading(entry) ? (entry.fresh === true ? 'fresh' : 'stale') : [],
      labelValue: (value, { t }) => optionLabel(t, `reviewList.freshness.${value}`, value),
    },
    {
      key: 'kind', label: 'reviewList.facetKind', fixedValues: ['video', 'image'], minValues: 1,
      values: (entry) => evalIsReading(entry) ? kindsOf(entry).filter((kind) => kind === 'video' || kind === 'image') : [],
      matches: (entry, selected) => selected === 'all' || (evalIsReading(entry) && kindsOf(entry).includes(selected)),
      labelValue: (value, { t }) => optionLabel(t, `evalsFeed.kind.${value}`, value),
      available: (found, _items, state) => found.length > 0 || state.kind !== 'all',
    },
    { key: 'node', label: 'reviewList.facetNode', values: (entry) => entry.node },
    {
      key: 'filer', label: 'reviewList.facetFiler', values: (entry) => evalIsReading(entry) ? entry.by : [],
      labelValue: (value, { sessions = [] }) => shortSession(value, sessions),
    },
    {
      key: 'live', label: 'reviewList.facetLive', values: (entry, { sessions }) => evalIsLive(entry, sessions) ? '1' : [],
      minValues: 1, available: (_found, items, state, { sessions }) => state.live === '1' || items.some((item) => evalIsLive(item, sessions)),
      labelValue: (_value, { t }) => optionLabel(t, 'reviewList.live', 'Live session'),
    },
  ],
}

export function evalFilterModel(items, raw = {}, context = {}) {
  const state = evalFilterState(raw, {
    defaultKind: context.defaultKind ?? 'all',
    defaultSection: context.defaultSection ?? '',
  })
  const model = filterReviewItems(items, state, EVAL_CONFIG, context)
  model.section = {
    key: 'ok', label: optionLabel(context.t, 'reviewList.facetReview', 'Review'), value: state.ok,
    meaningful: Object.values(model.sections).filter((count) => count > 0).length > 1 || !!state.ok,
    options: [allOption(context.t), ...EVAL_CONFIG.section.options.map((option) => ({
      value: option.value,
      label: optionLabel(context.t, option.label, option.value),
      count: model.sections[option.value] || 0,
    }))].filter((option, index) => index === 0 || option.count > 0 || option.value === state.ok),
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
