import { useT } from './i18n/index.jsx'
import { useWorkspaceApi } from './workspace.jsx'
import { Icon } from './icons.jsx'

// [[tab-strip]]'s landing place: the workspace holding nothing, said out loud.
//
// Closing the last tab used to navigate to the graph, so the board appeared underneath a gesture that had
// asked for nothing — the reader had closed their work and been handed a document they never opened. An
// empty workspace is a real state and this is what it looks like: the frame intact (rail, dock, status
// bar), the content area quiet, and every door out named rather than implied.
//
// The doors are the ways INTO a document, in the order a reader reaches for them: search by name, or browse
// the tree. There used to be a third — open the graph — and it left with the graph's retirement from the
// workspace ([[node-graph]]): every door here has to lead somewhere the workspace still sends people.

export default function EmptyView() {
  const t = useT()
  const { openPalette, setDock, setDockMode } = useWorkspaceApi()
  const showExplorer = () => { setDockMode('explorer'); setDock(true) }
  return (
    <div className="empty-view">
      <div className="empty-card">
        <h1 className="empty-title">{t('empty.title')}</h1>
        <p className="empty-hint">{t('empty.hint')}</p>
        <div className="empty-doors">
          <button type="button" className="empty-door" onClick={() => openPalette('nodes')}>
            <Icon name="search" size={14} /><span>{t('empty.search')}</span>
          </button>
          <button type="button" className="empty-door" onClick={showExplorer}>
            <Icon name="files" size={14} /><span>{t('empty.explorer')}</span>
          </button>
        </div>
      </div>
    </div>
  )
}
