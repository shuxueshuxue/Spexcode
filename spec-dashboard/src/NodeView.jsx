import { useCallback, useEffect, useRef, useState } from 'react'
import { filterMenuGroups } from '@spexcode/spec-core/review'
import { BlobMedia } from './Evidence.jsx'
import { useT } from './i18n/index.jsx'
import { useKeyboardScope } from './KeyboardService.jsx'
import { fetchNodeFiles, specUrl } from './data.js'
import { PUBLIC_GRAPH_ONLY } from './public-mode.js'
import IssueCard from './IssueCard.jsx'
import { apiUrl } from './project.js'
import { addressHash, reviewListAddress } from './address.js'
import { newTabAnchor } from './tabs.js'
import { routeHash } from './route.js'
import { Icon } from './icons.jsx'
import { GLYPH } from './specMeta.js'
import { CompactReviewFilter, nextQuery } from './ReviewShell.jsx'
import { locatePart } from './proseSelection.js'
import { stripProseTitle } from './proseTokens.js'
import Prose from './Prose.js'
import { setToken } from '@spexcode/spec-core/review'
import { useReviewPage } from './reviewPage.js'
import ProseActions from './ProseActions.jsx'
import NodeDiagram from './NodeDiagram.jsx'
import { useSpecContent } from './specContent.js'
import 'katex/dist/katex.min.css'

export { useSpecContent } from './specContent.js'

export const PANES = [
  { key: 'spec',    label: 'spec' },
  { key: 'history', label: 'history' },
  { key: 'issues',  label: 'issues' },
]

export function panesFor(node, graphOnly = PUBLIC_GRAPH_ONLY) {
  if (graphOnly) return [{ key: 'spec', label: 'spec' }]
  return node?.overlays?.length ? [{ key: 'edit', label: 'edit' }, ...PANES] : PANES
}

const paneReviewQuery = (kind, nodeId, filter = {}) => {
  let text = `is:issue${filter.q ? ` ${String(filter.q).trim()}` : ''}`.trim()
  const tokenKeys = { state: 'state', author: 'author', store: 'store', session: 'session' }
  for (const [key, token] of Object.entries(tokenKeys)) if (filter[key]) text = setToken(text, token, filter[key])
  return setToken(text, 'node', nodeId)
}

const FILTER_LABELS = {
  state: 'reviewList.facetState', author: 'reviewList.facetAuthor',
  store: 'reviewList.facetStore', session: 'reviewList.facetSession',
}

const pageFilterModel = (data, t) => {
  const localize = (facet) => facet && ({ ...facet, label: t(FILTER_LABELS[facet.key] || facet.label || facet.key) })
  return {
    section: localize(data?.section),
    facets: Object.fromEntries(Object.entries(data?.facets || {}).map(([key, facet]) => [key, localize(facet)])),
  }
}

// Compatibility shell: all body callers now cross the shared markdown-it token boundary. The legacy
// implementation above remains named (and removable in the later surface migrations), but is no longer
// reachable from a dashboard surface.
export function SpecBody({ body, lineBase = 0 }) {
  // A spec body is a document: its authoring wraps reflow (Prose's default), unlike the session timeline.
  if (!body) return null
  const { source, removedLines } = stripProseTitle(body)
  const base = lineBase > 0 ? lineBase + removedLines : 0
  return <Prose className="doc-body" lineBase={base}
    renderSpecRef={(id, token, provenance) => {
      const href = routeHash('spec', id)
      return <a className="doc-link" href={href} {...provenance} onClick={(event) => newTabAnchor(event, href)}>{id}</a>
    }}
    renderEvidence={(meta, token, provenance) => <span className="rich-evidence" data-evidence-hash={meta.hash} {...provenance}><BlobMedia hash={meta.hash} alt={meta.alt} /></span>}>
    {source}
  </Prose>
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
// A part is a slice of the body with its heading removed, so its blocks must be numbered against the WHOLE
// body or a manual edit would put lines back in the wrong place ([[prose-selection]]). `locatePart` places
// the slice and verifies the placement; an unplaceable part renders exactly as before, just unstamped.
function TwoPart({ parts, body }) {
  const t = useT()
  const rawAt = locatePart(body, parts.rawSource)
  const expandedAt = locatePart(body, parts.expandedSpec)
  return (
    <div className="spec-parts">
      <PartCard kind="raw" title={t('nodeView.rawTitle')} owner="human" ownerLabel={t('nodeView.rawOwner')} note={t('nodeView.rawNote')}>
        <SpecBody body={parts.rawSource} lineBase={rawAt?.startLine || 0} />
      </PartCard>
      <PartCard kind="expanded" title={t('nodeView.expandedTitle')} owner="agent" ownerLabel={t('nodeView.expandedOwner')} note={t('nodeView.expandedNote')}>
        <SpecBody body={parts.expandedSpec} lineBase={expandedAt?.startLine || 0} />
      </PartCard>
    </div>
  )
}

// The `code:` list is a row of file doors. The claim stays in the spec prose, while the bytes live at the
// file's own address. Plain clicks remain ordinary anchors so the workspace tab semantics stay in tabs.js;
// ctrl/⌘ uses the same hold helper as the explorer.
function GovernedFiles({ files, count }) {
  const t = useT()
  // a `code:` entry may name a SYMBOL inside a file (`SpecNode.jsx#SpecNode`) — several entries then point
  // at one file. The chip keeps the claim's own wording; the door is the file address.
  const pathOf = (entry) => entry.split('#')[0]
  return (
    <div className="doc-gov">
      <span className="doc-gov-h">{t('nodeView.governs')} <b>{count}</b></span>
      <div className="doc-gov-files">
        {files.map((f) => {
          const path = pathOf(f)
          const href = routeHash('file', path)
          return (
            <a key={f} className="gov-f" href={href} onClick={(event) => newTabAnchor(event, href)}>{f}</a>
          )
        })}
      </div>
    </div>
  )
}

// [[node-attachments]]: the rest of what a node's folder holds. A node has always been a FOLDER — its eval
// contract, an evidence directory, a raw capture, a note written beside the spec that cites it — and the
// board could see exactly one file in it. These remain in the same chip row as governed files, but their
// logical `.spec/<node>/<name>` address lets FileView use the node-owned read gate without an embedded reader.
const attachmentPath = (nodeId, name) => `.spec/${nodeId}/${name}`

function NodeAttachments({ nodeId, enabled }) {
  const t = useT()
  const [files, setFiles] = useState(null)
  useEffect(() => {
    if (!enabled) return undefined
    let live = true
    fetchNodeFiles(nodeId).then((f) => live && setFiles(f)).catch(() => live && setFiles([]))
    return () => { live = false }
  }, [nodeId, enabled])
  if (!files?.length) return null
  return (
    <div className="doc-gov doc-att">
      <span className="doc-gov-h">{t('nodeView.carries')} <b>{files.length}</b></span>
      <div className="doc-gov-files">
        {files.map((f) => {
          const href = routeHash('file', attachmentPath(nodeId, f.name))
          return <a key={f.name} className="gov-f" href={href} data-tip={`${(f.size / 1024).toFixed(1)} KB`}
            onClick={(event) => newTabAnchor(event, href)}>{f.name}</a>
        })}
      </div>
    </div>
  )
}

export function SpecPane({ node, graphOnly = PUBLIC_GRAPH_ONLY }) {
  const t = useT()
  const content = useSpecContent(node.id, node.version, { embedded: node.body != null })
  const driftTitle = (node.driftFiles || []).map((d) => `${d.file}: ${t('specNode.driftAhead', { n: d.behind })}`).join('\n')
  return (
    <div className="pane-doc">
      <h1 className="doc-title">{node.title}</h1>
      <blockquote className="doc-desc">{node.desc}</blockquote>
      <div className="doc-stat">
        <span className={`stat-status st-${node.status}`} data-tip={t('nodeView.statusLabel')}>
          <i className="stat-dot" />{t(`status.${node.status}`)}
        </span>
        <span className="stat-chip" data-tip={t('nodeView.versionLabel')}>v{node.version || 0}</span>
        {node.drift > 0 && <span className="stat-chip stat-drift" data-tip={driftTitle}>⚠{node.drift}</span>}
        <span className="stat-sess" data-tip={t('nodeView.lastEditedBy')}>✎ <b>{node.session || t('common.none')}</b></span>
      </div>
      {node.code?.length > 0 ? (
        <GovernedFiles files={node.code} count={node.code.length} />
      ) : (
        <div className="doc-gov prose"><span className="doc-gov-h">{t('nodeView.proseNode')}</span></div>
      )}
      {!graphOnly && <NodeAttachments nodeId={node.id} enabled />}
      {content?.diagram && <NodeDiagram nodeId={node.id} diagram={content.diagram} />}
      {(() => {
        // body/parts are lazy-loaded ([[graph-lean]]); `node.* ??` keeps a fixture (or a fuller payload) working.
        // While the fetch is in flight (content still null, nothing on the node) show a spinner rather than an
        // empty pane, so a slow/remote /content read reads as loading, not as a bodyless node. A FAILED fetch
        // resolves content to `{body:'',parts:null}` (not null), so it lands on the empty body, never a spinner
        // that never stops. parts come from the backend (`/content`); null → a legacy one-blob body renders whole.
        if (content === null && node.body == null) return <div className="pane-loading"><span className="spinner" aria-label={t('common.loading')} /></div>
        const body = node.body ?? content?.body ?? ''
        const parts = node.parts ?? content?.parts ?? null
        return parts ? <TwoPart parts={parts} body={body} /> : <SpecBody body={body} lineBase={1} />
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
    sc.addEventListener('scroll', onScroll, { passive: true })
    return () => sc.removeEventListener('scroll', onScroll)
  }, [revealNext])
  useKeyboardScope((event) => {
    if (event.key !== 'j' && event.key !== 'ArrowDown') return false
    const sc = scRef.current
    if (!sc || sc.scrollHeight - sc.clientHeight - sc.scrollTop > 1) return false
    event.preventDefault(); revealNext(); return true
  }, 5)
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
function HistoryEvidence({ node, r }) {
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

export function IssuesPane({ node, filter = {}, onFilter = () => {} }) {
  const t = useT()
  const query = paneReviewQuery('issue', node.id, filter)
  const page = useReviewPage('issues', query, 1, { pollMs: 0 })
  if (page.loading) return <div className="pane-issues pane-loading"><span className="spinner" aria-label={t('common.loading')} /></div>
  if (page.error) return <div className="pane-issues empty">{page.error}</div>
  const issues = page.data?.items || []
  const nodeTotal = (node.reviewSummary?.issues?.open || 0) + (node.reviewSummary?.issues?.closed || 0)
  if (!nodeTotal) return <div className="pane-issues empty">{t('nodeView.noIssues')}</div>
  const model = pageFilterModel(page.data, t)
  const open = issues.filter((i) => i.status === 'open')
  const closed = issues.filter((i) => i.status !== 'open')
  const groups = filterMenuGroups(model, onFilter, ['section', 'author', 'store', 'session'])
  return (
    <div className="pane-issues">
      {nodeTotal > 4 && <CompactReviewFilter value={filter.q || ''} onChange={(q) => onFilter({ q: q || null })}
        summary={{ shown: issues.length, total: page.data.total }}
        placeholder={t('nodeView.filterIssues')} searchLabel={t('reviewList.searchIssues')}
        filterLabel={t('reviewList.filters')} clearLabel={t('reviewList.all')} clearSearchLabel={t('reviewList.clearSearch')} groups={groups} />}
      {!issues.length && <div className="pane-filter-none">{t('nodeView.filterNone')}</div>}
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
      {page.data.total > issues.length && (
        <a className="pane-view-all" href={addressHash(reviewListAddress('issues', query))}>
          {t('reviewList.showing', { shown: issues.length, total: page.data.total })} <Icon name="chevron-right" size={13} />
        </a>
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
        <span className={`ov-mark ov-${ov.op}`}>{GLYPH[ov.op] || '•'}</span>
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

// PANES keys map to localized tab labels (the key drives logic; only the label is shown).
const PANE_LABEL = { spec: 'nodeView.paneSpec', history: 'nodeView.paneHistory', issues: 'nodeView.paneIssues', edit: 'nodeView.paneEdit' }

export default function NodeView({ node, pane, setPane, onClose, sessions = [], graphOnly = PUBLIC_GRAPH_ONLY }) {
  const t = useT()
  const proseRef = useRef(null)
  const [filters, setFilters] = useState({ issues: {} })
  const updateFilter = (kind, patch) => setFilters((current) => ({
    ...current,
    [kind]: nextQuery(current[kind], patch),
  }))
  const issueOpen = node.reviewSummary?.issues?.open || 0
  const issueClosed = node.reviewSummary?.issues?.closed || 0
  const editCount = (node.overlays || []).length
  const panes = panesFor(node, graphOnly)
  // render the pane the user picked, but fall back to the first available if it isn't valid for THIS node
  // (e.g. 'edit' is selected, then a node with no overlay opens) — so a tab is always shown, never blank.
  const active = panes.some((p) => p.key === pane) ? pane : panes[0].key
  // the version log feeds only the history pane, so its fetch waits for that tab (lazy like edit);
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
                    {issueOpen > 0 && <span className="ovc st-open" data-tip={t('nodeView.openIssues', { n: issueOpen })}>{issueOpen}</span>}
                    {issueClosed > 0 && <span className="ovc st-closed" data-tip={t('nodeView.closedIssues', { n: issueClosed })}>{issueClosed}</span>}
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
          {active === 'spec' && (
            <div className="pane-solo" ref={proseRef}>
              <SpecPane node={node} graphOnly={graphOnly} />
              {!graphOnly && <ProseActions node={node} hostRef={proseRef} />}
            </div>
          )}
          {active === 'history' && <HistoryPane node={node} rows={rows} />}
          {active === 'issues' && <IssuesPane node={node} sessions={sessions} filter={filters.issues} onFilter={(patch) => updateFilter('issues', patch)} />}
          {active === 'edit' && <EditPane node={node} />}
        </div>
      </div>
    </div>
  )
}
