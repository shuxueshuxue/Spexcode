import { useT } from './i18n/index.jsx'
import { useWorkspaceApi } from './workspace.jsx'
import { Icon } from './icons.jsx'

// [[tab-strip]]'s landing place: the workspace holding nothing, said out loud. Closing the last object
// must leave the frame intact without conjuring a graph document the reader did not ask to open.
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
