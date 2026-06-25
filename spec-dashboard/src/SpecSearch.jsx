import { useEffect, useMemo, useRef, useState } from 'react'
import { STATUS } from './SpecNode.jsx'
import { scenarioStates } from './score.jsx'
import { STATUS_COLOR, sessionName } from './session.js'
import { useT } from './i18n/index.jsx'
import { rankDocs } from '../../spec-cli/src/ranker.ts'

// @@@ SpecSearch - the `/` palette. It searches the board's FOUR planes at once — spec nodes, live
// sessions, the issues bound to nodes, and those nodes' scenarios — through ONE uniform pipeline: every
// searchable thing is flattened to a typed `entry` of the same shape (three ranking tiers + display fields +
// a target), so one rank() and one row renderer serve all four. On pick the entry is handed back whole; App
// routes by kind — a spec, issue, or scenario FOCUSES its node (the board's drill-down then opens its spine +
// pans the camera, the same focus state the arrows drive), a session JUMPS to its tab on the session board.
// No per-type branching lives here beyond building the entries; the palette itself is type-agnostic.

// a scenario row's dot reads its satisfaction the way the tile/panel do (score.jsx): green fresh pass · red
// fresh fail · grey stale / never-measured.
const SCEN_COLOR = { pass: 'var(--green)', fail: 'var(--red)', stalePass: 'var(--muted)', staleFail: 'var(--muted)', empty: 'var(--muted)', missing: 'var(--muted)' }

// the breadcrumb path the rows show + match against (`.spec/a/b/<id>/spec.md` minus the shell + leaf),
// so a row reads like the tree path it is. Mirrors SessionInterface's @-mention path.
const specPath = (p) => (p || '').replace(/^\.spec\//, '').replace(/\/spec\.md$/, '')

// equal-score ties group by plane (nodes, then sessions, then issues, then scenarios) so an empty/loose
// query reads as an ordered jump-list rather than an interleaved jumble.
const KIND_ORDER = { spec: 0, session: 1, issue: 2, scenario: 3 }

// @@@ buildEntries - fold the FOUR planes into one flat list of uniform entries. Each carries what a row
// renders (kind, dot colour, title, sub) and the `target` App acts on, PLUS the three fields the shared scorer
// reads — name / desc / body — mapped per plane. Issues and scenarios are flattened OFF their host node (board
// folds `node.issues`/`node.scenarios` on); each remembers its node so picking it focuses where it lives.
function buildEntries(specs, sessions) {
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
      name: `${s.title || s.id} ${s.id}`, desc: s.desc || '', body: s.body || '',
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
        title: sc.name, sub: path,
        name: sc.name || '', desc: '', body: sc.expected || '',
      })
    }
  }
  for (const s of sessions) {
    const name = sessionName(s)
    const sub = s.promptPreview || s.note || s.status || ''
    entries.push({
      kind: 'session', key: `session:${s.id}`, target: s.id,
      color: STATUS_COLOR[s.status] || STATUS_COLOR.offline,
      title: name, sub,
      name: name || '', desc: s.status || '', body: s.promptPreview || s.note || '',
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
const PLANES = ['spec', 'session', 'issue', 'scenario']
function rank(entries, query) {
  const jump = (a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.length - b.name.length || a.key.localeCompare(b.key)
  if (!query.trim()) return entries.slice().sort(jump).slice(0, 15)
  const ranked = {}
  for (const k of PLANES) {
    const docs = entries.filter((e) => e.kind === k).sort((a, b) => a.name.length - b.name.length || a.key.localeCompare(b.key))
    ranked[k] = rankDocs(query, docs.map((e) => ({ ref: e, name: e.name, desc: e.desc, body: e.body })), { limit: 15 }).map((r) => r.ref)
  }
  const out = []
  for (let i = 0; out.length < 15; i++) {
    let added = false
    for (const k of PLANES) if (ranked[k][i] && out.length < 15) { out.push(ranked[k][i]); added = true }
    if (!added) break
  }
  return out
}

export default function SpecSearch({ specs, sessions, onPick, onClose }) {
  const t = useT()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)
  const entries = useMemo(() => buildEntries(specs, sessions), [specs, sessions])
  const results = useMemo(() => rank(entries, q), [entries, q])

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
    <div className="search-backdrop" onClick={onClose}>
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
              <span className="search-path">{e.sub}</span>
            </li>
          ))}
        </ul>
        <div className="search-foot">{t('search.hint')}</div>
      </div>
    </div>
  )
}
