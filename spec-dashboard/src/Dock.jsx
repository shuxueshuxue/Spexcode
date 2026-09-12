import DockToggle from './DockToggle.jsx'
import FileTree from './FileTree.jsx'
import { useT } from './i18n/index.jsx'
import { withShortcut } from './bindings.js'
import { Icon, IconButton } from './icons.jsx'
import { collapseExplorerFolders, useExplorerFolded } from './specTreeState.js'
import { useResizable } from './useResizable.js'
import { DOCK_BAND } from './dockBand.js'
import { useArrival } from './useFold.js'
import { useWorkspaceApi } from './workspace.jsx'
import { useBackendHealth } from './BackendStatus.jsx'

// [[dock-modes]]: one finding dock, two projections. Shell owns mode persistence; this component renders
// the selected projection and keeps every row on the existing route/tab contracts.
//
// THE DOCK IS ONE BAND. A projection may not mint chrome of its own: the name, the tally and the doors all
// live in the single header row below, so switching projection changes what the dock LISTS and never how
// thick the dock is. Explorer's count row, the sessions "+" and the archive door were three separate strips
// stacked around one list; that is three answers to a question the shell already answers once.
// The explorer's one band. Left: what it is looking at, named in sentence case and tallied. Right: the doors
// it owns — icon-only, because the row is already saying which projection it is. The SESSIONS projection is
// the session forest itself ([[session-forest]]), which carries its own row of doors; this head belongs to
// the explorer alone.
//
// SEARCH IS ONE OF THOSE DOORS, and that is why it left the rail ([[side-nav]]). A rail search button had to
// name a scope it could not know — it sat above both projections and opened one of them, so the reader
// asking "search what?" got the answer "whichever the button's author picked". Here the question is already
// answered by the row the button sits in.
function DockHead({ specs }) {
  const t = useT()
  const { offline } = useBackendHealth()
  const { openPalette } = useWorkspaceApi()
  const folded = useExplorerFolded()
  return (
    <div className="dock-head">
      <span className="dock-head-name">{t('dockModes.explorer')}</span>
      <span className="dock-head-count">{specs?.length || 0}{offline && <em className="dock-stale">{t('backend.stale')}</em>}</span>
      {/* The header owns the projection's doors, and — last, at the panel's far corner — the switch that folds
          the panel itself (DockToggle); closed, that switch stands in the tab strip instead. */}
      <span className="dock-head-acts">
        {/* COLLAPSE FOLDERS is a door of the EXPLORER, not of either section inside it: the Specs tree and
            the Files tree are two projections of one list, so the one action that folds every open folder
            sits on the row both share — the same place an editor's explorer keeps it — and clears both
            ledgers at once ([[file-tree]]). Disabled rather than hidden when nothing is open, so the head
            keeps one shape. Sections themselves stay as the reader left them; only folders fold. */}
        <IconButton icon="collapse-all" size={13} className="dock-head-act" label={t('dockModes.collapseFolders')}
          disabled={folded} onClick={collapseExplorerFolders} />
        <button type="button" className="dock-head-act" data-tip={withShortcut(t('dockModes.searchNodes'), 'graph.search')}
          aria-label={t('dockModes.searchNodes')} onClick={() => openPalette('nodes')}>
          <Icon name="search" size={13} />
        </button>
        <DockToggle className="dock-head-act" />
      </span>
    </div>
  )
}

export default function Dock({ specs, focusId, closing = false, folding = false }) {
  // 200px is the resting width: wide enough for a session headline or a file name to read before it
  // ellipses, narrow enough that the finding dock stays a margin beside the document rather than a second
  // column competing with it. A reader who wants more drags it, and that choice is what persists — the
  // default only decides what an unopinionated window looks like.
  const [width, onDrag, reset] = useResizable(DOCK_BAND.key, DOCK_BAND.initial, DOCK_BAND)
  // `data-fold` says WHY this panel appeared — `'in'` a fold, `'swap'` a route handover, absent at rest.
  // Only a fold is a width movement. The handover half is read HERE and not from the shell's flag because
  // the shell stays mounted across the route switch that replaces its dock: the mount is the only witness
  // ([[dock-modes]], `useArrival`).
  const arrival = useArrival(folding)
  return (
    <aside className={closing ? 'dock dock-closing' : 'dock'} data-fold={arrival || undefined}
      style={{ width }} aria-hidden={closing ? 'true' : undefined}>
      <DockHead specs={specs} />
      <FileTree specs={specs} focusId={focusId} embedded />
      <div className="ft-resize" onMouseDown={onDrag} onDoubleClick={reset} role="separator" aria-orientation="vertical" />
    </aside>
  )
}
