import { useMemo, useRef } from 'react'
import { PendingChanges, ProseBody, SpecPane, VersionDiff } from './NodeView.jsx'
import ProseActions from './ProseActions.jsx'
import { useSpecVersion } from './specHistory.js'
import { useDocumentAction } from './documentActions.jsx'
import { useT } from './i18n/index.jsx'
import { Icon } from './icons.jsx'
import { routeHash } from './route.js'
import { Segmented } from './Segmented.jsx'
import { newTabAnchor } from './tabs.js'
import { useViewScope } from './ViewScope.jsx'
import { useBoard } from './workspace.jsx'

// [[spec-view]]: a spec node is a DOCUMENT whose full surface is prose. Governed files and attachments are
// links in that prose; their source lives at an independent file address and is never mounted here.
//
// The prose renderer is the SAME pane the popup uses, not a second one. A document and a popup showing the
// same node must never be two implementations that can disagree about what the node says; the popup keeps
// its place as a quick lens on board focus, and this is where a node is READ.
//
// A node a live worktree is changing has a second face, `?surface=diff`: the same head over the popup's own
// change pane. A ghost (a node only a worktree proposes) has nothing else to read, so it always shows it.
//
// `?version=<hash>` reads one of the node's past versions instead of its current body, and `surface=diff`
// beside it is the change that version made. The face switch is the same toggle on both: `surface=diff`
// always means "the change" of whatever revision the address names.

const CHANGE_SURFACE = 'diff'

// A past version: its own title and desc over a property row that says which version this is, a face switch
// between its text and the change it made, and the way back to the current document. Its prose carries no
// line provenance and no selection layer — those address the file as it is now ([[prose-selection]]).
function VersionFace({ node, hash, changeFace, onFace }) {
  const t = useT()
  const version = useSpecVersion(node.id, hash)
  const current = routeHash('spec', node.id)
  const back = (
    <a className="stat-back" href={current} onClick={(event) => newTabAnchor(event, current)}>
      <Icon name="corner-up-left" size={12} />{t('specView.versionBack', { n: node.version || 0 })}
    </a>
  )
  if (!version) return <div className="pane-doc"><div className="pane-loading"><span className="spinner" aria-label={t('common.loading')} /></div></div>
  if (version.error) {
    return (
      <div className="pane-doc spec-version">
        <h1 className="doc-title">{node.title}</h1>
        <div className="doc-stat">{back}</div>
        <p className="version-missing">{t('specView.versionMissing', { error: version.error })}</p>
      </div>
    )
  }
  return (
    <div className="pane-doc spec-version">
      <h1 className="doc-title">{version.title}</h1>
      <blockquote className="doc-desc">{version.desc}</blockquote>
      <div className="doc-stat">
        <span className="stat-chip stat-version" data-tip={t('specView.versionOf', { n: version.version, total: version.versions })}>v{version.version}</span>
        <code className="stat-hash">{hash.slice(0, 7)}</code>
        <span className="stat-date">{(version.date || '').slice(0, 10)}</span>
        <Segmented label={t('specView.versionFace')} value={changeFace ? 'change' : 'text'} onPick={onFace}
          options={[{ value: 'text', label: t('specView.versionText') }, { value: 'change', label: t('specView.versionChange') }]} />
        {back}
        <span className="stat-sess" data-tip={t('nodeView.lastEditedBy')}>✎ <b>{version.session || t('common.none')}</b></span>
      </div>
      <p className="version-reason">{version.reason}</p>
      {changeFace ? <VersionDiff id={node.id} hash={hash} /> : <ProseBody body={version.body} parts={version.parts} stamped={false} />}
    </div>
  )
}

export default function SpecView({ param, query }) {
  const t = useT()
  const { specs, sessions } = useBoard()
  const scope = useViewScope()
  const node = useMemo(() => specs?.find((s) => s.id === param), [specs, param])
  const proseRef = useRef(null)

  const version = query?.version || null
  const pending = node?.overlays?.length || 0
  const asked = query?.surface === CHANGE_SURFACE
  const changeFace = !!node?.ghost || asked
  // the toggle stays on the change face after the overlay dissolves, so a landed change never strands the reader.
  // A past version always has a change to show, so its toggle is always there.
  const toggleable = !!node && !node.ghost && (!!version || pending > 0 || asked)
  const openFace = (change) => {
    const face = { ...(version ? { version } : {}), ...(change ? { surface: CHANGE_SURFACE } : {}) }
    scope.open({ page: 'spec', param, query: Object.keys(face).length ? face : null }, { replace: true })
  }
  const toggle = () => openFace(!asked)
  const toggleLabel = version
    ? t(asked ? 'specView.versionShowText' : 'specView.versionShowChange')
    : t(asked ? 'specView.changeClose' : 'specView.changeOpen')
  useDocumentAction(routeHash('spec', param, query), toggleable ? {
    id: 'change-switcher', icon: 'git-compare', priority: 79, pressed: asked, label: toggleLabel, onClick: toggle,
  } : null)

  if (!specs?.length) return <div className="doc-empty">{t('hud.loading')}</div>
  if (!node) return <div className="doc-empty">{t('specView.missing', { id: param })}</div>

  if (version) {
    return (
      <div className="specview">
        <div className="specview-prose">
          <VersionFace node={node} hash={version} changeFace={asked} onFace={(face) => openFace(face === 'change')} />
        </div>
      </div>
    )
  }

  const stat = pending > 0 || asked ? (
    <button type="button" className="stat-change" aria-pressed={changeFace} disabled={!toggleable} onClick={toggle}
      data-tip={toggleable ? t(asked ? 'specView.changeClose' : 'specView.changeOpen') : undefined}>
      <Icon name="git-compare" size={12} />{t('specView.pendingChanges', { n: pending })}
    </button>
  ) : null

  return (
    <div className="specview">
      <div className="specview-prose" ref={proseRef}>
        <SpecPane node={node} stat={stat}>{changeFace ? <PendingChanges node={node} sessions={sessions} /> : null}</SpecPane>
        {/* the prose pane's selection layer ([[prose-dispatch]]) — pure z-layers over the reading column,
            so the document's own geometry is exactly what it was without it. Its line addressing is the
            prose's, so the change face carries none. */}
        {!changeFace && <ProseActions node={node} hostRef={proseRef} openSend={query?.send === '1'} />}
      </div>
    </div>
  )
}
