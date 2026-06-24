import { useEffect, useMemo, useRef, useState } from 'react'
import { STATUS } from './SpecNode.jsx'
import { scenarioStates } from './score.jsx'
import { STATUS_COLOR, sessionName } from './session.js'
import { useT } from './i18n/index.jsx'

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

// @@@ buildEntries - fold the three planes into one flat list of uniform entries. Each carries the tiers
// rank() scores (primary = the human name, secondary = the stable id/number, tertiary = the path/context)
// plus what a row needs to render (kind, dot colour, title, sub) and the `target` App acts on. Issues are
// flattened OFF their host node (board folds `node.issues` on); each remembers its node so picking it
// focuses where the issue lives — an issue DOES against a node, so jumping to the node is the right landing.
function buildEntries(specs, sessions) {
  const entries = []
  for (const s of specs) {
    const path = specPath(s.path)
    entries.push({
      kind: 'spec', key: `spec:${s.id}`, target: s.id,
      color: (STATUS[s.status] || STATUS.pending).color,
      title: s.title || s.id, sub: path,
      primary: s.title || s.id, secondary: s.id, tertiary: path,
    })
    for (const i of s.issues || []) {
      const open = (i.state || '').toLowerCase() === 'open'
      entries.push({
        kind: 'issue', key: `issue:${s.id}:${i.number}`, target: s.id,
        color: open ? 'var(--green)' : 'var(--muted)',
        title: i.title, sub: `#${i.number} · ${path}`,
        primary: i.title || '', secondary: `#${i.number}`, tertiary: path,
      })
    }
    // scenarios DO against a node like issues; flattened OFF it (board folds `node.scenarios`/`node.evals`),
    // each matching on its name (primary) and its `expected` prose (tertiary), and landing on its host node.
    for (const sc of scenarioStates(s.scenarios, s.evals)) {
      entries.push({
        kind: 'scenario', key: `scenario:${s.id}:${sc.name}`, target: s.id,
        color: SCEN_COLOR[sc.state] || 'var(--cyan)',
        title: sc.name, sub: path,
        primary: sc.name || '', secondary: '', tertiary: `${sc.expected || ''} ${path}`,
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
      primary: name || '', secondary: s.id, tertiary: sub,
    })
  }
  return entries
}

// rank entries for the query: a hit in the human name (primary) outranks the id/number (secondary), and a
// prefix beats a mid-string hit within each; the path/context (tertiary) is the lowest match. Empty query
// lists everything (a plain jump-list). Ties group by plane, then by shorter name (most specific floats up).
function rank(entries, query) {
  const q = query.trim().toLowerCase()
  const scored = []
  for (const e of entries) {
    const p = e.primary.toLowerCase()
    const s = e.secondary.toLowerCase()
    const t = e.tertiary.toLowerCase()
    let score
    if (!q) score = 5
    else if (p.startsWith(q)) score = 0
    else if (s.startsWith(q)) score = 1
    else if (p.includes(q)) score = 2
    else if (s.includes(q)) score = 3
    else if (t.includes(q)) score = 4
    else continue
    scored.push({ e, score })
  }
  scored.sort((a, b) =>
    a.score - b.score ||
    KIND_ORDER[a.e.kind] - KIND_ORDER[b.e.kind] ||
    a.e.primary.length - b.e.primary.length ||
    a.e.key.localeCompare(b.e.key))
  return scored.slice(0, 15).map((x) => x.e)
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
