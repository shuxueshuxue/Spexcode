import { useCallback, useEffect, useRef, useState } from 'react'
import { ScoreBadge, readingScore, ScenarioCount, scenarioStates, TabCount, TagChips } from './score.jsx'
import { EVAL_FILTER_KIND, evidenceList, evalFilterModel, filterMenuGroups, issueFilterModel } from './reviewFilters.js'
import { EvidenceItem } from './Evidence.jsx'
import { Replies } from './Thread.jsx'
import { useT } from './i18n/index.jsx'
import { specUrl } from './data.js'
import IssueCard from './IssueCard.jsx'
import { apiUrl } from './project.js'
import { addressHash, evalAddress } from './address.js'
import { Icon } from './icons.jsx'
import { CompactReviewFilter, nextQuery, ReviewState } from './ReviewShell.jsx'

export const PANES = [
  { key: 'spec',    label: 'spec' },
  { key: 'history', label: 'history' },
  { key: 'issues',  label: 'issues' },
  { key: 'eval',    label: 'eval' },
]

export function panesFor(node) {
  return node?.overlays?.length ? [{ key: 'edit', label: 'edit' }, ...PANES] : PANES
}

// op → glyph, kept local (a 4-entry map) so this popup never imports the graph node just for it.
const OP_GLYPH = { added: '+', edited: '~', deleted: '✕', moved: '→' }

// minimal inline markdown the spec bodies use — `code`, **bold**, [[links]]; anything else is plain text (no markdown dep)
function inline(text) {
  const out = []
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\[\[([^\]]+)\]\]/g
  let last = 0, m, k = 0
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1] != null) out.push(<code key={k++}>{m[1]}</code>)
    else if (m[2] != null) out.push(<strong key={k++}>{m[2]}</strong>)
    else out.push(<span className="doc-link" key={k++}>{m[3]}</span>)
    last = re.lastIndex
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

// a GFM table delimiter row — `|---|:--:|--:|` — what separates the header from the body and marks a
// pipe-line as a real TABLE (not prose that happens to contain a `|`). Must carry a pipe so a bare `---`
// horizontal rule after a pipe-paragraph isn't misread as one.
function isTableDelim(line) {
  const s = line.trim()
  return s.includes('|') && /^\|?(\s*:?-+:?\s*\|)+(\s*:?-+:?\s*)?$/.test(s)
}
// split one table row into trimmed cells, dropping the outer pipes. Cell text keeps its inline markdown
// (`code`, **bold**, [[links]]) — it runs back through inline() like any other prose.
function tableCells(line) {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|')) s = s.slice(0, -1)
  return s.split('|').map((c) => c.trim())
}
// per-column alignment from the delimiter cell: `:--:` center · `--:` right · else default (left).
function colAlign(cell) {
  const l = cell.startsWith(':'), r = cell.endsWith(':')
  return l && r ? 'center' : r ? 'right' : null
}

// fence-aware tokenizer for the spec.md body — ``` code, # headings, - lists, | GFM tables |, paragraphs;
// drops the leading `# title` line (the header already shows it). Exported: the issues page's detail pane
// ([[issues-view]]) renders issue bodies/replies through this same renderer, so issue markdown and spec
// markdown read as one dialect.
export function SpecBody({ body }) {
  if (!body) return null
  const lines = body.replace(/^#\s+[^\n]*\n+/, '').split('\n')
  const out = []
  let i = 0, k = 0, inFence = false
  while (i < lines.length) {
    const t = lines[i].trim()
    if (/^```/.test(t)) {
      const buf = []; i++
      while (i < lines.length && !/^```/.test(lines[i].trim())) buf.push(lines[i++])
      i++ // closing fence
      out.push(<pre className="doc-pre" key={k++}><code>{buf.join('\n')}</code></pre>)
    } else if (/^#{1,6}\s+/.test(lines[i])) {
      out.push(<h4 className="doc-h" key={k++}>{inline(lines[i].replace(/^#+\s+/, ''))}</h4>); i++
    } else if (t.includes('|') && i + 1 < lines.length && isTableDelim(lines[i + 1])) {
      const head = tableCells(lines[i])
      const aligns = tableCells(lines[i + 1]).map(colAlign)
      i += 2
      const rows = []
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '' && !/^```/.test(lines[i].trim())) {
        rows.push(tableCells(lines[i])); i++
      }
      out.push(
        <table className="doc-table" key={k++}>
          <thead><tr>{head.map((c, j) => <th key={j} style={aligns[j] ? { textAlign: aligns[j] } : undefined}>{inline(c)}</th>)}</tr></thead>
          <tbody>{rows.map((r, ri) => (
            <tr key={ri}>{head.map((_, ci) => <td key={ci} style={aligns[ci] ? { textAlign: aligns[ci] } : undefined}>{inline(r[ci] ?? '')}</td>)}</tr>
          ))}</tbody>
        </table>
      )
    } else if (/^-\s+/.test(t)) {
      const items = []
      while (i < lines.length && /^-\s+/.test(lines[i].trim())) items.push(lines[i++].trim().replace(/^-\s+/, ''))
      out.push(<ul key={k++}>{items.map((it, j) => <li key={j}>{inline(it)}</li>)}</ul>)
    } else if (t === '') {
      i++
    } else {
      const buf = []
      while (i < lines.length) {
        const l = lines[i]
        if (l.trim() === '' || /^```/.test(l.trim()) || /^#{1,6}\s+/.test(l) || /^-\s+/.test(l.trim())) break
        // a table starting on the next line ends this paragraph even without a blank separator.
        if (l.includes('|') && i + 1 < lines.length && isTableDelim(lines[i + 1])) break
        buf.push(l); i++
      }
      out.push(<p key={k++}>{inline(buf.join(' '))}</p>)
    }
  }
  return <div className="doc-body">{out}</div>
}

// the two labelled parts (node.parts): raw source (human) · expanded spec (agent).
// Legacy bodies (parts === null) fall back to the whole-body SpecBody.
function PartCard({ kind, title, owner, ownerLabel, note, children }) {
  return (
    <section className={`spec-part part-${kind}`}>
      <header className="part-head">
        <span className="part-title">{title}</span>
        <span className={`part-owner owner-${owner}`}>{ownerLabel}</span>
        {note && <span className="part-note">{note}</span>}
      </header>
      <div className="part-body">{children}</div>
    </section>
  )
}
function TwoPart({ parts }) {
  const t = useT()
  return (
    <div className="spec-parts">
      <PartCard kind="raw" title={t('nodeView.rawTitle')} owner="human" ownerLabel={t('nodeView.rawOwner')} note={t('nodeView.rawNote')}>
        <SpecBody body={parts.rawSource} />
      </PartCard>
      <PartCard kind="expanded" title={t('nodeView.expandedTitle')} owner="agent" ownerLabel={t('nodeView.expandedOwner')} note={t('nodeView.expandedNote')}>
        <SpecBody body={parts.expandedSpec} />
      </PartCard>
    </div>
  )
}

// body + parts are NOT on the board ([[graph-lean]]); fetch them when a node opens. `/api/specs/:id/content`
// returns both (the backend does the parse), so there is no client-side parser to keep in sync. Cached per
// (id, version) so re-opening is instant, but a NEW version (the board carries the live version) misses the
// stale entry and refetches — the detail prose can never lag the version badge above it. A non-OK response is
// shown but never cached, so a transient 404 during a backend reload can't poison the node until a reload.
const contentCache = new Map()
function useSpecContent(id, version) {
  const key = `${id}@${version ?? ''}`
  const [content, setContent] = useState(() => contentCache.get(key) ?? null)
  useEffect(() => {
    const hit = contentCache.get(key)
    if (hit) { setContent(hit); return }             // cached (re-open) → instant, no spinner
    setContent(null)                                  // drop the previous node/version's prose while the new one loads
    let on = true
    fetch(specUrl(id, 'content')).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => { contentCache.set(key, d); if (on) setContent(d) })   // land the body the instant it arrives — no artificial delay
      .catch(() => { if (on) setContent({ body: '', parts: null }) })
    return () => { on = false }
  }, [id, version, key])
  return content
}

export function SpecPane({ node }) {
  const t = useT()
  const content = useSpecContent(node.id, node.version)
  const driftTitle = (node.driftFiles || []).map((d) => `${d.file}: ${t('specNode.driftAhead', { n: d.behind })}`).join('\n')
  return (
    <div className="pane-doc">
      <h1># {node.title}</h1>
      <blockquote>{node.desc}</blockquote>
      <div className="doc-stat">
        <span className={`stat-status st-${node.status}`} data-tip={t('nodeView.statusLabel')}>
          <i className="stat-dot" />{t(`status.${node.status}`)}
        </span>
        <span className="stat-chip" data-tip={t('nodeView.versionLabel')}>v{node.version || 0}</span>
        <ScenarioCount scenarios={node.scenarios} evals={node.evals} href={addressHash(evalAddress(node.id))} />
        {node.drift > 0 && <span className="stat-chip stat-drift" data-tip={driftTitle}>⚠{node.drift}</span>}
        <span className="stat-sess" data-tip={t('nodeView.lastEditedBy')}>✎ <b>{node.session || t('common.none')}</b></span>
      </div>
      {node.code?.length > 0 ? (
        <div className="doc-gov">
          <span className="doc-gov-h">{t('nodeView.governs')} <b>{node.code.length}</b></span>
          <div className="doc-gov-files">{node.code.map((f) => <code key={f} className="gov-f">{f}</code>)}</div>
        </div>
      ) : (
        <div className="doc-gov prose"><span className="doc-gov-h">{t('nodeView.proseNode')}</span></div>
      )}
      {(() => {
        // body/parts are lazy-loaded ([[graph-lean]]); `node.* ??` keeps a fixture (or a fuller payload) working.
        // While the fetch is in flight (content still null, nothing on the node) show a spinner rather than an
        // empty pane, so a slow/remote /content read reads as loading, not as a bodyless node. A FAILED fetch
        // resolves content to `{body:'',parts:null}` (not null), so it lands on the empty body, never a spinner
        // that never stops. parts come from the backend (`/content`); null → a legacy one-blob body renders whole.
        if (content === null && node.body == null) return <div className="pane-loading"><span className="spinner" aria-label={t('common.loading')} /></div>
        const body = node.body ?? content?.body ?? ''
        const parts = node.parts ?? content?.parts ?? null
        return parts ? <TwoPart parts={parts} /> : <SpecBody body={body} />
      })()}
    </div>
  )
}

// the node's version log from git (/api/specs/:id/history), newest first. `enabled` gates the fetch to the
// history tab actually showing (every popup open otherwise fires it for a tab most opens never visit); rows
// persist across tab switches, so only the FIRST visit loads — returns stay instant, same as the other panes.
export function useHistory(id, enabled = true) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    if (!enabled) return
    let on = true
    fetch(specUrl(id, 'history')).then((r) => r.json()).then((d) => { if (on) setRows(d) }).catch(() => on && setRows([]))
    return () => { on = false }
  }, [id, enabled])
  return rows
}

// one version's spec.md line-diff (/api/specs/:id/diff/:hash), fetched lazily on expand (`enabled` gates it);
// memoised per (id,hash) since a commit's diff is immutable, so re-expanding reads the cache, no refetch/flash.
const versionDiffCache = new Map()
function useVersionDiff(id, hash, enabled) {
  const key = `${id}/${hash}`
  const [diff, setDiff] = useState(() => versionDiffCache.get(key) ?? null)
  useEffect(() => {
    if (!enabled) return
    const cached = versionDiffCache.get(key)
    if (cached) { setDiff(cached); return }
    let on = true
    fetch(specUrl(id, 'diff', hash)).then((r) => r.json())
      .then((d) => { versionDiffCache.set(key, d); if (on) setDiff(d) })
      .catch(() => on && setDiff({ patch: '' }))
    return () => { on = false }
  }, [id, hash, enabled, key])
  return diff
}

// git unified patch → renderable lines. Skip everything before the first `@@` wholesale (file-header metadata),
// so an extended header line isn't mis-read as content; in the hunk body slice the ` `/`+`/`-` marker; `\` is git's no-newline note.
function parseDiff(patch) {
  const out = []
  let inBody = false
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) { inBody = true; out.push({ t: 'hunk', s: line }); continue }
    if (!inBody || line.startsWith('\\')) continue
    if (line.startsWith('+')) out.push({ t: 'add', s: line.slice(1) })
    else if (line.startsWith('-')) out.push({ t: 'del', s: line.slice(1) })
    else out.push({ t: 'ctx', s: line.slice(1) })
  }
  while (out.length && out[out.length - 1].t === 'ctx' && out[out.length - 1].s === '') out.pop()
  return out
}

// diff == null → still loading (lazy on expand); empty patch → a version with no recorded spec.md change
function DiffEvidence({ diff }) {
  const t = useT()
  if (diff == null) return <figcaption className="ev-note">{t('nodeView.loadingChange')}</figcaption>
  const lines = diff.patch ? parseDiff(diff.patch) : []
  if (!lines.length) return <figcaption className="ev-note">{t('nodeView.noChange')}</figcaption>
  return (
    <>
      <figcaption className="ev-difflabel">{t('nodeView.diffLabel')}</figcaption>
      <pre className="ev-diff">{lines.map((l, i) => <div key={i} className={`dl dl-${l.t}`}>{l.s || ' '}</div>)}</pre>
    </>
  )
}

function ChronoPane({ items, itemKey, classes, rowClass, renderHeader, renderEvidence, renderAction, leading, trailing, resetKey }) {
  const scRef = useRef(null)
  const [open, setOpen] = useState(() => new Set([0]))   // latest expanded; the rest reveal on scroll
  // a caller filtering its items passes the filter as resetKey: the open set is INDEX-keyed, so surviving
  // rows shift under a stale set — re-anchoring on the latest keeps the open state meaningful.
  useEffect(() => { if (resetKey !== undefined) setOpen(new Set([0])) }, [resetKey])
  const toggle = useCallback((i) => setOpen((prev) => {
    const next = new Set(prev)
    if (next.has(i)) next.delete(i); else next.add(i)
    return next
  }), [])
  // reveal the next collapsed item, one per call, only once the deepest open item's end is in view
  // (getBoundingClientRect, not offsetTop, so the scroller's own positioning doesn't matter).
  const revealNext = useCallback(() => setOpen((prev) => {
    const sc = scRef.current
    if (!sc) return prev
    let f = -1
    while (prev.has(f + 1)) f++
    if (f < 0 || f >= items.length - 1) return prev
    const el = sc.querySelector(`[data-i="${f}"]`)
    if (!el || el.getBoundingClientRect().bottom - sc.getBoundingClientRect().top > sc.clientHeight + 40) return prev
    return new Set(prev).add(f + 1)
  }), [items])
  // two reveal triggers: (1) the scroll event while there's overflow to move through; (2) a j/↓ keypress when
  // the scroller can't move further (sub-page content or already at the bottom) — without (2) those cases dead-end.
  useEffect(() => {
    const sc = scRef.current
    if (!sc) return
    let prevTop = sc.scrollTop
    const onScroll = () => {
      const top = sc.scrollTop, down = top > prevTop
      prevTop = top
      if (down) revealNext()
    }
    const onKey = (e) => {
      if (e.key !== 'j' && e.key !== 'ArrowDown') return
      if (sc.scrollHeight - sc.clientHeight - sc.scrollTop > 1) return  // room to scroll → (1) handles it
      revealNext()
    }
    sc.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('keydown', onKey, true)   // capture: App stopPropagation()s j/k but same-target listeners still run
    return () => { sc.removeEventListener('scroll', onScroll); window.removeEventListener('keydown', onKey, true) }
  }, [revealNext])
  return (
    <div className={classes.pane} ref={scRef}>
      {leading}
      {items.map((it, i) => {
        const isOpen = open.has(i)
        const mod = rowClass ? rowClass(it, i) : ''
        return (
          <div data-i={i} key={itemKey(it, i)} className={`${classes.row}${mod ? ` ${mod}` : ''}${isOpen ? ' open' : ''}`}>
            <button className={classes.head} onClick={() => toggle(i)} aria-expanded={isOpen}>
              {renderHeader(it, i, isOpen)}
            </button>
            {/* a row's outbound affordance (e.g. the eval detail anchor) renders as a SIBLING of the
                toggle — interactive controls never nest inside one another. */}
            {renderAction?.(it, i)}
            {isOpen && <figure className={classes.evidence}>{renderEvidence(it, i)}</figure>}
          </div>
        )
      })}
      {trailing}
    </div>
  )
}

// every version's diff fetches lazily when its row opens (memoised by hash; see useVersionDiff)
function HistoryEvidence({ node, r, latest }) {
  const fetched = useVersionDiff(node.id, r.hash, true)
  return <DiffEvidence diff={fetched} />
}

export function HistoryPane({ node, rows }) {
  const t = useT()
  if (!rows) return <div className="pane-hist empty">{t('nodeView.loadingHistory')}</div>
  if (!rows.length) return <div className="pane-hist empty">{t('common.noVersions')}</div>
  return (
    <ChronoPane
      items={rows}
      itemKey={(r) => r.hash}
      classes={{ pane: 'pane-hist', row: 'ver-row', head: 'rec-toggle', evidence: 'rec-evidence' }}
      rowClass={(r, i) => (i === 0 ? 'latest' : '')}
      renderHeader={(r, i, open) => (
        <>
          <div className="rec-head">
            <span className="rec-caret">{open ? '▾' : '▸'}</span>
            <span className="rec-v">v{rows.length - i}</span>
            <code className="rec-hash">{r.hash.slice(0, 7)}</code>
            <span className="rec-date">{(r.date || '').slice(0, 10)}</span>
            <span className="rec-diff">
              <b className="rec-add">+{r.additions ?? 0}</b>
              <b className="rec-del">−{r.deletions ?? 0}</b>
            </span>
          </div>
          <div className="rec-msg">{r.reason}</div>
          <div className="rec-sub">{t('nodeView.filesChanged', { n: r.files ?? 0 })} · {r.session || t('common.idle')}</div>
        </>
      )}
      renderEvidence={(r, i) => <HistoryEvidence node={node} r={r} latest={i === 0} />}
    />
  )
}

export function IssuesPane({ node, sessions = [], filter = {}, onFilter = () => {} }) {
  const t = useT()
  const issues = node.issues || []
  if (!issues.length) return <div className="pane-issues empty">{t('nodeView.noIssues')}</div>
  const model = issueFilterModel(issues, filter, { sessions, t, defaultSection: '' })
  const shown = model.shown
  const open = shown.filter((i) => i.status === 'open')
  const closed = shown.filter((i) => i.status !== 'open')
  const groups = filterMenuGroups(model, onFilter, ['section', 'author', 'store', 'session'])
  return (
    <div className="pane-issues">
      {issues.length > 4 && <CompactReviewFilter value={model.state.q} onChange={(q) => onFilter({ q: q || null })}
        summary={{ shown: model.shown.length, total: issues.length }}
        placeholder={t('nodeView.filterIssues')} searchLabel={t('reviewList.searchIssues')}
        filterLabel={t('reviewList.moreFilters')} clearLabel={t('reviewList.all')} clearSearchLabel={t('reviewList.clearSearch')} groups={groups} />}
      {!shown.length && <div className="pane-filter-none">{t('nodeView.filterNone')}</div>}
      {open.length > 0 && (
        <>
          <div className="issue-group-head">{t('nodeView.openIssues', { n: open.length })}</div>
          {open.map((i) => <IssueCard key={i.id} issue={i} />)}
        </>
      )}
      {closed.length > 0 && (
        <>
          <div className="issue-group-head closed">{t('nodeView.closedIssues', { n: closed.length })}</div>
          {closed.map((i) => <IssueCard key={i.id} issue={i} />)}
        </>
      )}
    </div>
  )
}

// the node's pending change diff (/api/edit, editing worktree vs fork point), fetched lazily when the edit tab opens.
// Memoised per (source,path) but revalidated each open (cache seeds the paint, a background fetch refreshes it) since
// the change is live; a failed revalidate keeps the last good diff.
const editDiffCache = new Map()
function useEditDiff(source, path, enabled) {
  const key = `${source}\t${path}`
  const [diff, setDiff] = useState(() => editDiffCache.get(key) ?? null)
  useEffect(() => {
    if (!enabled || !source || !path) return
    const cached = editDiffCache.get(key)
    if (cached) setDiff(cached)   // show the last diff at once; the fetch below refreshes it (the change is live)
    let on = true
    fetch(apiUrl(`/api/edit?source=${encodeURIComponent(source)}&path=${encodeURIComponent(path)}`))
      .then((r) => r.json())
      .then((d) => { editDiffCache.set(key, d); if (on) setDiff(d) })
      .catch(() => on && setDiff((prev) => prev ?? { patch: '' }))
    return () => { on = false }
  }, [source, path, enabled, key])
  return diff
}

function EditOverlay({ node, ov }) {
  const t = useT()
  const diff = useEditDiff(ov.source, node.path, true)
  return (
    <figure className="edit-rev">
      <figcaption className="edit-by">
        <span className={`ov-mark ov-${ov.op}`}>{OP_GLYPH[ov.op] || '•'}</span>
        <span className="edit-by-label">{ov.label}</span>
        <span className="edit-state">{ov.committed ? t('nodeView.editCommitted') : t('nodeView.editDirty')}</span>
      </figcaption>
      <DiffEvidence diff={diff} />
    </figure>
  )
}
export function EditPane({ node }) {
  const t = useT()
  const overlays = node.overlays || []
  if (!overlays.length) return <div className="pane-edit empty">{t('nodeView.noEdit')}</div>
  return <div className="pane-edit">{overlays.map((ov, i) => <EditOverlay key={i} node={node} ov={ov} />)}</div>
}

function VerdictBadge({ verdict }) {
  const t = useT()
  if (!verdict) return <span className="eval-verdict legacy">{t('nodeView.eval.legacy')}</span>
  if (verdict.status === 'pass') return <span className="eval-verdict pass">{t('nodeView.eval.pass')}</span>
  if (verdict.status === 'fail') return <span className="eval-verdict fail">{t('nodeView.eval.fail')}</span>
  // legacy note-only reading (status:'note' predates the annotation model); new readings are always pass/fail
  return <span className="eval-verdict note" data-tip={verdict.note}>{t('nodeView.eval.note')}</span>
}

function EvalEvidence({ r }) {
  const t = useT()
  // a reading's evidence is a LIST — render it as a GALLERY (N images + a video…); empty → the honest
  // no-evidence / miss sentinel (a note-only reading, or one whose sole blob was pruned).
  const ev = evidenceList(r)
  return (
    <>
      {r.expected && <div className="eval-expected"><span className="eval-expected-label">{t('nodeView.eval.expected')}</span> {r.expected}</div>}
      {r.verdict?.note && <div className="eval-note"><span className="eval-expected-label">{t('nodeView.eval.noteLabel')}</span> {r.verdict.note}</div>}
      {ev.length > 0
        ? <div className="eval-gallery" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{ev.map((e, i) => <EvidenceItem key={`${e.hash}-${i}`} e={e} alt={t('nodeView.eval.shotAlt', { scenario: r.scenario })} />)}</div>
        : <figcaption className="eval-noimg">{r.blobState === 'miss' ? t('nodeView.eval.miss') : t('nodeView.eval.noImage')}</figcaption>}
    </>
  )
}

function DeclaredScenario({ s }) {
  const t = useT()
  return (
    <div className="eval-row eval-declared-row">
      <span className="eval-top">
        <ScoreBadge state="empty" title={t('score.missing')} />
        <span className="eval-scenario">{s.name}</span>
        <TagChips tags={s.tags} />
        {s.code?.length > 0 && <code className="eval-tracks">{s.code.join(', ')}</code>}
      </span>
      {s.expected && <div className="eval-expected"><span className="eval-expected-label">{t('nodeView.eval.expected')}</span> {s.expected}</div>}
    </div>
  )
}

// a DANGLING remark track ([[remark-teeth]] / directive 5): a (node, scenario) whose scenario was
// renamed/deleted, so no reading joins it. Its remarks would otherwise surface nowhere — here they render at
// node level, the orphaned scenario name struck through and marked gone, each remark still resolvable/
// retractable via its ref (`spex resolve`/`spex retract`). It ages nothing (there is no reading to stale).
function DanglingTrack({ track }) {
  const t = useT()
  return (
    <div className="eval-row eval-dangling-row">
      <span className="eval-top">
        <span className="eval-dangling-badge" data-tip={t('nodeView.eval.danglingTitle')}>⚠</span>
        <span className="eval-scenario eval-dangling-name">{track.scenario}</span>
        <span className="eval-dangling-tag">{t('nodeView.eval.danglingGone')}</span>
      </span>
      <div className="eval-dangling-remarks"><Replies replies={track.remarks} /></div>
    </div>
  )
}

// the full reading history is NOT on the board ([[graph-lean]]): the board's `evals` is only the latest
// reading per scenario, so this tab lazy-loads the whole timeline from `/api/specs/:id/evals` when opened.
// The board's `scenarios` fold is slim too ({name, tags}), so the declared set — with each scenario's
// expected and tracked files for the blind-spot rows — comes from the SAME fetch, which carries it whole.
// Cache keyed by the summary's newest ts + count, so a fresh filing misses and refetches; a FAILED fetch
// falls back to the board's summary readings + slim scenarios — truthful, just shallow — never a spinner
// that never stops.
const evalCache = new Map()
export function EvalPane({ node, sessions = [], filter = {}, onFilter = () => {} }) {
  const t = useT()
  const key = `${node.id}@${node.evals?.[0]?.ts || ''}:${node.evals?.length || 0}`
  const [timeline, setTimeline] = useState(() => evalCache.get(key) ?? null)
  useEffect(() => {
    if (evalCache.has(key)) { setTimeline(evalCache.get(key)); return }
    let on = true
    setTimeline(null)
    fetch(specUrl(node.id, 'evals')).then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((tl) => { const v = { scenarios: tl.scenarios || node.scenarios || [], readings: tl.readings || [], dangling: tl.dangling || [] }; evalCache.set(key, v); if (on) setTimeline(v) })
      .catch(() => { if (on) setTimeline({ scenarios: node.scenarios || [], readings: node.evals || [], dangling: [] }) })
    return () => { on = false }
  }, [key, node.id])
  if (!node.evals) return <div className="pane-eval empty">{t('nodeView.eval.noScenarios')}</div>
  if (timeline === null) return <div className="pane-eval pane-loading"><span className="spinner" aria-label={t('common.loading')} /></div>
  const all = timeline.readings
  const filterItems = [
    ...all.map((reading, index) => ({ ...reading, node: node.id, filterKind: EVAL_FILTER_KIND.RESULT, filterKey: `${EVAL_FILTER_KIND.RESULT}:${index}`, source: reading })),
    ...scenarioStates(timeline.scenarios, all).filter((scenario) => !scenario.reading)
      .map((scenario) => ({ ...scenario, scenario: scenario.name, node: node.id, filterKind: EVAL_FILTER_KIND.UNMEASURED, filterKey: `${EVAL_FILTER_KIND.UNMEASURED}:${scenario.name}`, source: scenario })),
    ...(timeline.dangling || []).map((track) => ({ ...track, node: node.id, filterKind: EVAL_FILTER_KIND.DANGLING, filterKey: `${EVAL_FILTER_KIND.DANGLING}:${track.threadId}`, source: track })),
  ]
  const model = evalFilterModel(filterItems, filter, { sessions, t, defaultKind: 'all', defaultSection: '' })
  const readings = model.shown.filter((item) => item.filterKind === EVAL_FILTER_KIND.RESULT).map((item) => item.source)
  const unmeasured = model.shown.filter((item) => item.filterKind === EVAL_FILTER_KIND.UNMEASURED).map((item) => item.source)
  const dangling = model.shown.filter((item) => item.filterKind === EVAL_FILTER_KIND.DANGLING).map((item) => item.source)
  const groups = filterMenuGroups(model, onFilter, ['section', 'review', 'freshness', 'kind', 'filer', 'session'])
  const filterEl = filterItems.length > 4
    ? <CompactReviewFilter key="filter" value={model.state.q} onChange={(q) => onFilter({ q: q || null })}
      summary={{ shown: model.shown.length, total: filterItems.length }}
      placeholder={t('nodeView.filterScenarios')} searchLabel={t('reviewList.searchEvals')}
      filterLabel={t('reviewList.moreFilters')} clearLabel={t('reviewList.all')} clearSearchLabel={t('reviewList.clearSearch')} groups={groups} />
    : null
  // Branch on the unfiltered list so a no-match state never flips the tree and remounts the compact search
  // mid-word — a filtered-to-empty timeline stays a ChronoPane with its controls intact.
  if (!all.length) return (
    <div className="pane-eval pane-eval-declared">
      {filterEl}
      <div className="eval-todo-note">{!model.shown.length ? t('nodeView.filterNone') : t('nodeView.eval.noReadings')}</div>
      {unmeasured.map((s) => <DeclaredScenario key={s.name} s={s} />)}
      {dangling.map((tr) => <DanglingTrack key={tr.threadId} track={tr} />)}
    </div>
  )
  // unmeasured scenarios lead the one timeline as blind-spot rows; orphaned tracks trail it — both the same
  // row frame, an empty ring / a struck-through gone-scenario respectively.
  return (
    <ChronoPane
      items={readings}
      resetKey={JSON.stringify(model.state)}
      leading={[
        filterEl,
        !model.shown.length
          ? <div key="none" className="pane-filter-none">{t('nodeView.filterNone')}</div>
          : null,
        ...unmeasured.map((s) => <DeclaredScenario key={s.name} s={s} />),
      ]}
      trailing={dangling.map((tr) => <DanglingTrack key={tr.threadId} track={tr} />)}
      itemKey={(r, i) => `${r.scenario}-${r.ts}-${i}`}
      classes={{ pane: 'pane-eval', row: 'eval-row', head: 'eval-head', evidence: 'eval-shot' }}
      // every reading row carries a REAL anchor out to the scenario's canonical full-page detail
      // (`#/evals/<node>/<scenario>`, a history PUSH) — a sibling of the expand toggle, never nested in it.
      renderAction={(r) => (
        <a className="eval-open" href={addressHash(evalAddress(node.id, r.scenario))}
          data-tip={t('nodeView.eval.openDetail')} aria-label={t('nodeView.eval.openDetail')}>
          <Icon name="chevron-right" size={14} />
        </a>
      )}
      renderHeader={(r, i, open) => (
        <>
          <span className="eval-top">
            <span className="eval-caret">{open ? '▾' : '▸'}</span>
            <span className="eval-scenario">{r.scenario}</span>
            <VerdictBadge verdict={r.verdict} />
            <ScoreBadge state={readingScore(r)} title={r.fresh ? undefined : t('nodeView.eval.staleAxes', { axes: r.staleAxes.join(', ') })} />
          </span>
          <span className="eval-meta">
            {r.evaluator && <span className="eval-evaluator">{r.evaluator}</span>}
            <code className="eval-sha">{r.codeSha.slice(0, 7)}</code>
            <span className="eval-ts">{r.ts.replace('T', ' ').slice(0, 16)}</span>
          </span>
        </>
      )}
      renderEvidence={(r) => <EvalEvidence r={r} />}
    />
  )
}

// PANES keys map to localized tab labels (the key drives logic; only the label is shown).
const PANE_LABEL = { spec: 'nodeView.paneSpec', history: 'nodeView.paneHistory', issues: 'nodeView.paneIssues', eval: 'nodeView.paneEval', edit: 'nodeView.paneEdit' }

export default function NodeView({ node, pane, setPane, onClose, sessions = [] }) {
  const t = useT()
  const [filters, setFilters] = useState({ issues: {}, eval: {} })
  const updateFilter = (kind, patch) => setFilters((current) => ({
    ...current,
    [kind]: nextQuery(current[kind], patch),
  }))
  const issuesAll = node.issues || []
  const issueOpen = issuesAll.filter((i) => i.status === 'open').length
  const issueClosed = issuesAll.length - issueOpen
  // the eval caption's verdict tally rides the SAME scenarioStates join every score surface reads
  // ([[eval-score-badge]]) — fresh passes and fresh fails, zero values omitted like the issues caption.
  const evalStates = scenarioStates(node.scenarios, node.evals)
  const evalPass = evalStates.filter((s) => s.state === 'pass').length
  const evalFail = evalStates.filter((s) => s.state === 'fail').length
  const editCount = (node.overlays || []).length
  const panes = panesFor(node)
  // render the pane the user picked, but fall back to the first available if it isn't valid for THIS node
  // (e.g. 'edit' is selected, then a node with no overlay opens) — so a tab is always shown, never blank.
  const active = panes.some((p) => p.key === pane) ? pane : panes[0].key
  // the version log feeds only the history pane, so its fetch waits for that tab (lazy like eval/edit);
  // once loaded the rows persist, so returning to the tab is instant — no reload flash.
  const rows = useHistory(node.id, active === 'history')
  return (
    <div className="ov-backdrop" data-focus-overlay onMouseDown={onClose}>
      <div className="ov-panel" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ov-head">
          <span className="ov-title">{node.title}</span>
          <div className="ov-tabs">
            {panes.map((p) => (
              <button key={p.key} className={p.key === active ? 'ov-tab on' : 'ov-tab'} onClick={() => setPane(p.key)}>
                {t(PANE_LABEL[p.key])}
                {p.key === 'issues' && (issueOpen > 0 || issueClosed > 0) && (
                  <span className="ov-tab-counts">
                    {issueOpen > 0 && <TabCount kind="issue" state="open" cls="st-open" n={issueOpen} label={t('nodeView.openIssues', { n: issueOpen })} />}
                    {issueClosed > 0 && <TabCount kind="issue" state="closed" cls="st-closed" n={issueClosed} label={t('nodeView.closedIssues', { n: issueClosed })} />}
                  </span>
                )}
                {p.key === 'eval' && (evalPass > 0 || evalFail > 0) && (
                  <span className="ov-tab-counts">
                    {evalPass > 0 && <TabCount kind="eval" state="pass" cls="st-pass" n={evalPass} label={t('nodeView.eval.passCount', { n: evalPass })} />}
                    {evalFail > 0 && <TabCount kind="eval" state="fail" cls="st-fail" n={evalFail} label={t('nodeView.eval.failCount', { n: evalFail })} />}
                  </span>
                )}
                {p.key === 'edit' && editCount > 0 && (
                  <span className="ov-tab-counts"><span className="ovc st-edit" data-tip={t('nodeView.pendingEdits', { n: editCount })}>{editCount}</span></span>
                )}
              </button>
            ))}
          </div>
          <span className="ov-hint">{t('nodeView.hint')}</span>
        </div>
        <div className="ov-body">
          {active === 'spec' && <div className="pane-solo"><SpecPane node={node} /></div>}
          {active === 'history' && <HistoryPane node={node} rows={rows} />}
          {active === 'issues' && <IssuesPane node={node} sessions={sessions} filter={filters.issues} onFilter={(patch) => updateFilter('issues', patch)} />}
          {active === 'eval' && <EvalPane node={node} sessions={sessions} filter={filters.eval} onFilter={(patch) => updateFilter('eval', patch)} />}
          {active === 'edit' && <EditPane node={node} />}
        </div>
      </div>
    </div>
  )
}
