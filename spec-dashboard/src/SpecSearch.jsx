import { useEffect, useMemo, useRef, useState } from 'react'
import { STATUS } from './SpecNode.jsx'
import { scenarioStates, TagChips } from './score.jsx'
import { STATUS_COLOR, sessionName, sessionHeadline } from './session.js'
import { useT } from './i18n/index.jsx'
import { rankDocs } from '../../spec-cli/src/ranker.ts'

// a scenario row's dot reads its satisfaction the way the tile/panel do (score.jsx): green fresh pass · red
// fresh fail · grey stale / never-measured.
const SCEN_COLOR = { pass: 'var(--green)', fail: 'var(--red)', stalePass: 'var(--muted)', staleFail: 'var(--muted)', empty: 'var(--muted)', missing: 'var(--muted)' }

// the breadcrumb path the rows show + match against (`.spec/a/b/<id>/spec.md` minus the shell + leaf),
// so a row reads like the tree path it is. Mirrors SessionInterface's @-mention path.
const specPath = (p) => (p || '').replace(/^\.spec\//, '').replace(/\/spec\.md$/, '')

// the four planes in default lead order (nodes first); equal-score ties group by plane so an empty/loose
// query reads as an ordered jump-list rather than an interleaved jumble. `boost` lifts ONE plane to the
// front — the SAME palette leads with whatever surface opened it (the session board boosts 'session'). This
// is the ONLY knob a caller turns: matcher, interleave, and keys are identical; only the lead order differs.
const BASE_PLANES = ['spec', 'session', 'issue', 'scenario']
const planeOrder = (boost) => (boost ? [boost, ...BASE_PLANES.filter((p) => p !== boost)] : BASE_PLANES)

// fold the four planes into one flat list of uniform entries; each carries the row's display fields, the
// `target` App acts on, and the scorer's name/desc/body fields mapped per plane (issues/scenarios keep their host node).
function buildEntries(specs, sessions, bodies) {
  const entries = []
  for (const s of specs) {
    const path = specPath(s.path)
    entries.push({
      kind: 'spec', key: `spec:${s.id}`, target: s.id,
      color: (STATUS[s.status] || STATUS.pending).color,
      title: s.title || s.id, sub: path,
      // the shared ranker's three fields, the SAME map the floor uses for a node: name = title+id, desc = the
      // one-line summary, body = the spec prose. So the palette ranks a node by the maths `spex search` runs —
      // prose reached via BM25, not the old whole-query substring. (Path is shown in `sub` but, like the floor,
      // no longer a search field — its segments are the node names/prose already in name+body.)
      // body is no longer on the board ([[board-lean]]) — it comes from the lazily-fetched corpus (`bodies`),
      // falling back to any body still on the node (a fixture, or before the corpus lands).
      name: `${s.title || s.id} ${s.id}`, desc: s.desc || '', body: bodies?.[s.id] ?? s.body ?? '',
    })
    for (const i of s.issues || []) {
      const open = (i.state || '').toLowerCase() === 'open'
      entries.push({
        kind: 'issue', key: `issue:${s.id}:${i.number}`, target: s.id,
        color: open ? 'var(--green)' : 'var(--muted)',
        title: i.title, sub: `#${i.number} · ${path}`,
        name: i.title || '', desc: `#${i.number}`, body: '',
      })
    }
    for (const sc of scenarioStates(s.scenarios, s.evals)) {
      entries.push({
        kind: 'scenario', key: `scenario:${s.id}:${sc.name}`, target: s.id,
        color: SCEN_COLOR[sc.state] || 'var(--cyan)',
        title: sc.name, sub: path, tags: sc.tags,
        name: sc.name || '', desc: '', body: sc.expected || '',
      })
    }
  }
  for (const s of sessions) {
    // a session reads as ONE name everywhere: the shared sessionHeadline ([[session-activity]]) the board rows,
    // window, tabs, and console header all show — NOT the raw stable handle, which left the palette naming a
    // session differently from the board it was searched from. The stable handle still rides in `body` so
    // search-by-node/branch/id keeps working even when the live self-summary has replaced it on screen.
    const headline = sessionHeadline(s)
    const handle = sessionName(s)
    const sub = s.status || s.promptPreview || s.note || ''
    entries.push({
      kind: 'session', key: `session:${s.id}`, target: s.id,
      color: STATUS_COLOR[s.status] || STATUS_COLOR.offline,
      title: headline, sub,
      name: headline || '', desc: s.status || '', body: `${s.promptPreview || s.note || ''} ${handle}`.trim(),
    })
  }
  return entries
}

// rank entries via the SHARED scorer (spec-cli/src/ranker.ts) — the same maths `spex search` runs server-side,
// so the palette no longer ranks node prose more crudely than the agent. An empty query is the plain
// jump-list (plane, then shorter name).
//
// Cross-plane: rank EACH plane separately, then INTERLEAVE by plane (a node, a session, an issue, a scenario,
// repeat). NOT one rankDocs over all four — nodes carry far richer text than sparse sessions/issues, so a
// single relevance list buries the non-node planes (a node-heavy query like "session" returns only nodes,
// verified in-browser). Per-plane ranking keeps the shared scorer's quality WITHIN a plane; the interleave
// keeps every matching plane visible — the palette's whole point. (The floor has only nodes, so it needs none
// of this; this cross-plane assembly is the one thing the palette adds on top of the shared core.)
function rank(entries, query, planes) {
  const order = Object.fromEntries(planes.map((k, i) => [k, i]))
  const jump = (a, b) => order[a.kind] - order[b.kind] || a.name.length - b.name.length || a.key.localeCompare(b.key)
  if (!query.trim()) return entries.slice().sort(jump).slice(0, 15)
  const ranked = {}
  for (const k of planes) {
    const docs = entries.filter((e) => e.kind === k).sort((a, b) => a.name.length - b.name.length || a.key.localeCompare(b.key))
    ranked[k] = rankDocs(query, docs.map((e) => ({ ref: e, name: e.name, desc: e.desc, body: e.body })), { limit: 15 }).map((r) => r.ref)
  }
  const out = []
  for (let i = 0; out.length < 15; i++) {
    let added = false
    for (const k of planes) if (ranked[k][i] && out.length < 15) { out.push(ranked[k][i]); added = true }
    if (!added) break
  }
  return out
}

// the body corpus for node-prose ranking ([[board-lean]]): the board omits `body`, so the palette fetches
// {id→body} from `/api/specs/lite` the first time it opens and reuses it (module cache) on every later open —
// once per session, off the board's hot poll. Until it lands, node ranking falls back to title+desc.
let bodyCorpus = null
function useBodyCorpus() {
  const [corpus, setCorpus] = useState(bodyCorpus)
  useEffect(() => {
    if (bodyCorpus) return
    let on = true
    fetch('/api/specs/lite').then((r) => r.json())
      .then((rows) => { bodyCorpus = Object.fromEntries((rows || []).map((r) => [r.id, r.body || ''])); if (on) setCorpus(bodyCorpus) })
      .catch(() => {})
    return () => { on = false }
  }, [])
  return corpus
}

export default function SpecSearch({ specs, sessions, onPick, onClose, boost = null }) {
  const t = useT()
  const bodies = useBodyCorpus()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const planes = useMemo(() => planeOrder(boost), [boost])
  const entries = useMemo(() => buildEntries(specs, sessions, bodies), [specs, sessions, bodies])
  const results = useMemo(() => rank(entries, q, planes), [entries, q, planes])

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => { setSel(0) }, [q])  // a fresh query always re-aims the highlight at the top result
  // keep the highlighted row in view as ↑/↓ walk past the visible window.
  useEffect(() => { listRef.current?.querySelector('.search-item.on')?.scrollIntoView({ block: 'nearest' }) }, [sel, results])

  // hand the whole entry back; App routes by kind (spec/issue → focus its node, session → its board tab).
  const pick = (e) => { if (e) { onPick(e); onClose() } }

  // the input OWNS its keys (App returns early while search is open — see onKey there), so ↑/↓ walk the
  // result list, Enter jumps to the highlighted entry, Esc closes; everything else types into the query.
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((i) => Math.min(results.length - 1, i + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((i) => Math.max(0, i - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(results[sel]) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  return (
    <div className="search-backdrop" data-focus-overlay onClick={onClose}>
      <div className="search-panel" role="dialog" aria-modal="true" aria-label={t('search.title')} onClick={(e) => e.stopPropagation()}>
        <div className="search-bar">
          <span className="search-icon">⌕</span>
          <input
            ref={inputRef}
            className="search-input"
            value={q}
            placeholder={t('search.placeholder')}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
          />
        </div>
        <ul className="search-results" ref={listRef}>
          {results.length === 0 && <li className="search-empty">{t('search.empty')}</li>}
          {results.map((e, i) => (
            <li
              key={e.key}
              className={`search-item${i === sel ? ' on' : ''}`}
              onMouseEnter={() => setSel(i)}
              onClick={() => pick(e)}
            >
              <span className="node-dot" style={{ background: e.color }} />
              <span className={`search-kind k-${e.kind}`}>{t(`search.kind.${e.kind}`)}</span>
              <span className="search-title">{e.title || e.target}</span>
              <TagChips tags={e.tags} />
              <span className="search-path">{e.sub}</span>
            </li>
          ))}
        </ul>
        <div className="search-foot">{t('search.hint')}</div>
      </div>
    </div>
  )
}
