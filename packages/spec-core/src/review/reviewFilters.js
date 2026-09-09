import { sessionPresent } from './session.js'
import { effectiveTokens, tokenize } from './reviewQuery.js'

// [[review-filters]]: one pure filter engine — the single home of Issues FIELD SEMANTICS. The domain
// adapter below provides field values; surfaces provide only the state home and presentation: the
// canonical page parses its ONE visible token text ([[review-query]]) and bridges it here, the Spec
// Information panes keep plain local state. Neither duplicates matching.

const text = (value) => String(value ?? '').trim().toLocaleLowerCase()
const values = (value) => (Array.isArray(value) ? value : value == null || value === '' ? [] : [value])
const unique = (items) => [...new Set(items.flatMap(values).filter((value) => value != null && value !== '').map(String))]

const optionLabel = (t, key, fallback) => t ? t(key) : fallback
const allOption = (t) => ({ value: '', label: optionLabel(t, 'reviewList.all', 'All') })
const optionsFor = (items, facet, state, context, t) => {
  const active = state[facet.key] != null && String(state[facet.key]) !== ''
  // a fixed-value ENUM facet keeps its ACTIVE value as a real (checked) row even when no data carries
  // it — an active facet must never hide its own off-switch; data-valued facets stay data-derived.
  const found = facet.fixedValues
    ? facet.fixedValues.filter((value) => (active && String(state[facet.key]) === String(value))
      || items.some((item) => values(facet.values(item, context)).map(String).includes(String(value))))
    : unique(items.map((item) => facet.values(item, context)))
  if (found.length < (facet.minValues ?? 2) && !active) return []
  return [allOption(t), ...found.map((value) => ({
    value,
    label: facet.labelValue ? facet.labelValue(value, context) : value,
  }))]
}

export function filterReviewItems(items, state, config, context = {}) {
  // `q` is one substring or an ARRAY of substrings (the token text's bare words/phrases), conjunctive;
  // an `impossible` state (an unknown qualifier in the canonical text) honestly matches NOTHING.
  const qs = values(state.q).map(text).filter(Boolean)
  const faceted = state.impossible ? [] : items.filter((item) => (
    qs.every((q) => config.search(item, context).some((value) => text(value).includes(q)))
    && config.facets.every((facet) => {
      const selected = state[facet.key]
      return selected == null || selected === '' || values(facet.values(item, context)).map(String).includes(String(selected))
    })
  ))
  const sectionValue = config.section && state[config.section.key]
  const sectionMatch = (item, selected) => (config.section.matches
    ? config.section.matches(item, selected, context)
    : String(config.section.value(item, context)) === String(selected))
  const shown = sectionValue == null || sectionValue === ''
    ? faceted
    : faceted.filter((item) => sectionMatch(item, sectionValue))
  // a section count is ONE number: the section's matched rows under the REST of the query.
  const sections = config.section
    ? Object.fromEntries(config.section.options.map((option) => [option.value, faceted.filter((item) => sectionMatch(item, option.value)).length]))
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
    author: raw.author || '', store: raw.store || '', node: raw.node || '', label: raw.label || '',
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
    { key: 'label', label: 'reviewList.facetLabel', values: (issue) => (issue.labels || []).map((label) => typeof label === 'string' ? label : label?.name), minValues: 1 },
    presenceFacet((issue, { sessions }) => issuePresent(issue, sessions) ? 'present' : 'missing'),
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
      count: model.sections[option.value],
    }))].filter((option, index) => index === 0 || option.count > 0 || option.value === state.state),
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

// the CANONICAL page's bridge ([[review-query]] → this engine): parse the ONE visible token text into
// engine state. Bare words/phrases become conjunctive q substrings; duplicate qualifiers are last-wins;
// a qualifier outside the page's map (or a wrong is: identity) marks the state IMPOSSIBLE — the token
// stays verbatim in the text and the list honestly shows nothing. One map per domain: adding a domain
// is adding its map here, never a second parser.
const TOKEN_MAPS = {
  issue: {
    is: (v) => (v === 'issue' ? {} : null),
    state: (v) => ({ state: v }),
    store: (v) => ({ store: v }),
    author: (v) => ({ author: v }),
    node: (v) => ({ node: v }),
    label: (v) => ({ label: v }),
    session: (v) => ({ session: v }),
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
